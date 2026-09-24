import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { db } from '@repo/database';
import { withSpan, AppAttributes } from '@repo/observability';
import { AuditQueueService, type OutboxTxClient } from '../common/audit-queue.service';

import type { ServerSession } from '../common/session.utils';
import {
  getEffectiveUserId,
  hasAdminRole,
  hasOperatorRole,
} from '../common/session.utils';
import { writeAuditRow } from '../common/audit-writer';
import { MetricsService } from '../common/observability/metrics.service';
import { AuthorizationService } from '../common/authorization.service';
import { CreateNoteDto, UpdateNoteDto, DEFAULT_LIMIT } from './dto/note.dto';

export type SerializedNote = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string | null };
};

const NOTE_INCLUDE = {
  author: { select: { id: true, name: true } },
} as const;

function serialize(note: {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string | null };
}): SerializedNote {
  return {
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/**
 * Prisma "record not found" (P2025) detector.
 *
 * update/delete are atomic single-statement writes: when the row vanishes
 * between the ownership pre-read and the write, Prisma throws P2025 instead
 * of returning a count. Duck-typed on `code` (rather than importing the
 * generated client error class) so the API tier stays decoupled from the
 * database package's generated-client path.
 */
function isRecordNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2025'
  );
}

/**
 * Domain rules mirrored 1:1 from the previous web-tier implementation so
 * the RBAC-parity gate (doc 3.4) can compare verdicts exactly:
 * - create/update/delete gated by the EFFECTIVE user's live permission
 *   (impersonating admin's id when impersonation is active)
 * - update restricted to the note's author unless the effective user holds
 *   an admin role token
 * - audit rows written here with request IP/UA attribution
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly authz: AuthorizationService,
    // @Optional: unit tests construct the service directly without a queue
    // and exercise the synchronous fallback; the Nest module ALWAYS provides
    // the queue, so production is background-only. Do NOT add more producers
    // without going through the queue (ordering) — see audit-writer.ts.
    @Optional() private readonly auditQueue?: AuditQueueService,
  ) {}

  /**
   * Local permission check against an already-loaded authoritative role.
   * Reuses the single source of AccessControl rules (ADMIN_PLUGIN_ROLES) —
   * same verdicts as `auth.api.userHasPermission` without its extra adapter
   * read. Callers MUST pass the fresh DB role, never the session snapshot.
   */
  assertPermission(
    roleRaw: string,
    action: 'create' | 'update' | 'delete',
  ): void {
    this.authz.assertPermission(roleRaw, 'notes', action);
  }

  async listForSession(
    session: ServerSession,
    limit = DEFAULT_LIMIT,
    offset = 0,
    // COUNT opt-out (see ListNotesQuery.withTotal). Default true =
    // backwards compatible; false skips the total probe for clients that
    // never render totals (web UI, k6). The authorization role read above is
    // untouched — security posture is identical either way.
    withTotal = true,
  ): Promise<{
    notes: SerializedNote[];
    viewerRole: string;
    /** Exact total, or `null` when skipped via `?withTotal=false`. */
    total: number | null;
    limit: number;
    offset: number;
    /** True when rows exist beyond this page (offset- or cursor-style). */
    hasMore: boolean;
  }> {
    return withSpan('notes.list', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'notes.list');
      span.setAttribute(AppAttributes.FEATURE, 'notes');
      span.setAttribute(AppAttributes.ENTITY_TYPE, 'note');

      try {
        // One authoritative role read per request — reused for scoping.
        const viewerRole = await this.authz.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
        const canListAll = hasOperatorRole(viewerRole);

        const where = canListAll ? undefined : { authorId: session.user.id };
        // Fetch limit+1 rows so `hasMore` is derived from the SAME single
        // findMany (no extra round trip). Ordering stays deterministic
        // (createdAt DESC, id DESC tie-break — matches the covering index),
        // so slicing the probe row off never shifts page contents.
        // When withTotal=false the count branch resolves without touching PG,
        // cutting this endpoint from 3 PG queries to 2 (role + findMany).
        const [rows, total] = await Promise.all([
          db.note.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: NOTE_INCLUDE,
            take: limit + 1,
            skip: offset,
          }),
          withTotal ? db.note.count({ where }) : Promise.resolve(null),
        ]);
        const hasMore = rows.length > limit;
        const notes = hasMore ? rows.slice(0, limit) : rows;

        this.metricsService.recordNoteOperation('list', 'success');
        return {
          notes: notes.map(serialize),
          viewerRole,
          total,
          limit,
          offset,
          hasMore,
        };
      } catch (err) {
        this.metricsService.recordNoteOperation('list', 'failure');
        throw err;
      }
    });
  }

  async create(
    session: ServerSession,
    dto: CreateNoteDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<SerializedNote> {
    return withSpan('notes.create', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'notes.create');
      span.setAttribute(AppAttributes.FEATURE, 'notes');
      span.setAttribute(AppAttributes.ENTITY_TYPE, 'note');

      try {
        // Single role fetch → permission check (no userHasPermission round trip).
        const roleRaw = await this.authz.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
        this.assertPermission(roleRaw, 'create');

        // Note + outbox row commit atomically - kill -9 before
        // commit loses both (client retries, idempotency dedupes); kill -9
        // after commit loses nothing (poller redelivers).
        const note = await db.$transaction(async (tx) => {
          const created = await tx.note.create({
            data: {
              title: dto.title,
              content: dto.content,
              authorId: session.user.id,
            },
            include: NOTE_INCLUDE,
          });
          await this.writeAudit(
            session,
            'note_created',
            meta,
            { noteId: created.id, title: created.title },
            tx as unknown as OutboxTxClient,
            'note_created:' + created.id,
          );
          return created;
        });

        span.setAttribute(AppAttributes.ENTITY_ID, note.id);

        this.metricsService.recordNoteOperation('create', 'success');
        return serialize(note);
      } catch (err) {
        this.metricsService.recordNoteOperation('create', 'failure');
        throw err;
      }
    });
  }

  async update(
    session: ServerSession,
    noteId: string,
    dto: UpdateNoteDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<SerializedNote> {
    return withSpan('notes.update', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'notes.update');
      span.setAttribute(AppAttributes.FEATURE, 'notes');
      span.setAttribute(AppAttributes.ENTITY_TYPE, 'note');
      span.setAttribute(AppAttributes.ENTITY_ID, noteId);

      try {
        // One authoritative role fetch reused for BOTH permission evaluation
        // and the admin ownership override (was 2 reads: userHasPermission +
        // getFreshRoleRaw).
        const roleRaw = await this.authz.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
        this.assertPermission(roleRaw, 'update');

        if (!dto.title?.trim() && !dto.content?.trim()) {
          throw new BadRequestException('Nothing to update.');
        }

        const isAdmin = hasAdminRole(roleRaw);

        const note = await db.note.findUnique({
          where: { id: noteId },
          include: NOTE_INCLUDE,
        });
        if (!note) throw new NotFoundException('Note not found.');
        if (!isAdmin && note.authorId !== session.user.id) {
          throw new ForbiddenException('You can only edit your own notes.');
        }

        // Single atomic write that also returns the updated row (1 query
        // instead of updateMany + refetch). Ownership/admin stays in JS on
        // purpose: folding `authorId` into the WHERE clause would conflate
        // 404 (missing) with 403 (not yours) and silently break the admin
        // override (admins may edit others' notes). authorId is immutable,
        // so the pre-read cannot go stale; a delete winning the race throws
        // P2025, mapped to 404 below.
        const updated = await db.$transaction(async (tx) => {
          let next: Parameters<typeof serialize>[0];
          try {
            next = await tx.note.update({
              where: { id: noteId },
              data: {
                ...(dto.title ? { title: dto.title } : {}),
                ...(dto.content ? { content: dto.content } : {}),
              },
              include: NOTE_INCLUDE,
            });
          } catch (err) {
            if (isRecordNotFoundError(err)) {
              throw new NotFoundException('Note not found.');
            }
            throw err;
          }
          await this.writeAudit(
            session,
            'note_updated',
            meta,
            { noteId, title: dto.title || note.title },
            tx as unknown as OutboxTxClient,
          );
          return next;
        });

        this.metricsService.recordNoteOperation('update', 'success');
        return serialize(updated);
      } catch (err) {
        this.metricsService.recordNoteOperation('update', 'failure');
        throw err;
      }
    });
  }

  async remove(
    session: ServerSession,
    noteId: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    return withSpan('notes.delete', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'notes.delete');
      span.setAttribute(AppAttributes.FEATURE, 'notes');
      span.setAttribute(AppAttributes.ENTITY_TYPE, 'note');
      span.setAttribute(AppAttributes.ENTITY_ID, noteId);

      try {
        const roleRaw = await this.authz.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
        this.assertPermission(roleRaw, 'delete');

        // Single atomic delete returning the title for the audit row (1 query
        // instead of findUnique + deleteMany). A missing row throws P2025,
        // mapped to 404 — no audit row for a deletion that never happened.
        await db.$transaction(async (tx) => {
          let existing;
          try {
            existing = await tx.note.delete({
              where: { id: noteId },
              select: { title: true },
            });
          } catch (err) {
            if (isRecordNotFoundError(err)) {
              throw new NotFoundException('Note not found.');
            }
            throw err;
          }
          await this.writeAudit(
            session,
            'note_deleted',
            meta,
            { noteId, title: existing.title },
            tx as unknown as OutboxTxClient,
          );
        });

        this.metricsService.recordNoteOperation('delete', 'success');
      } catch (err) {
        this.metricsService.recordNoteOperation('delete', 'failure');
        throw err;
      }
    });
  }

  /**
   * note_created/updated/deleted are BACKGROUND audits: domain
   * events with no privilege change. The queue preserves mutation→audit
   * ordering (sequential per-process drain) plus retry, and returns
   * immediately — removing 1 PG RTT from every mutation's critical path.
   * The synchronous fallback below runs ONLY when no queue is injected
   * (unit tests); production always has the global AuditQueueModule.
   */
  private async writeAudit(
    session: ServerSession,
    action: string,
    meta: { ip: string | null; userAgent: string | null },
    metadata?: Record<string, unknown>,
    tx?: OutboxTxClient,
    idempotencyKey?: string,
  ): Promise<void> {
    if (this.auditQueue) {
      // Awaited durable enqueue (resolves on outbox COMMIT); inside
      // $transaction the row commits atomically with the note mutation.
      await this.auditQueue.enqueueSessionAudit(
        session,
        { action, metadata },
        meta,
        tx || idempotencyKey ? { tx, idempotencyKey } : undefined,
      );
      return;
    }
    await writeAuditRow(session, { action, metadata }, meta);
  }
}
