import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { db } from '@repo/database';
import { auth } from '@repo/auth';
import { withSpan, AppAttributes } from '@repo/observability';

import type { ServerSession } from '../common/session.utils';
import {
  getEffectiveUserId,
  hasAdminRole,
  hasOperatorRole,
} from '../common/session.utils';
import { writeAuditRow } from '../common/audit-writer';
import { MetricsService } from '../common/observability/metrics.service';
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
 * Phase 3's RBAC-parity gate (doc 3.4) can compare verdicts exactly:
 * - create/update/delete gated by the EFFECTIVE user's live permission
 *   (impersonating admin's id when impersonation is active)
 * - update restricted to the note's author unless the effective user holds
 *   an admin role token
 * - audit rows written here with request IP/UA attribution
 */
@Injectable()
export class NotesService {
  constructor(private readonly metricsService: MetricsService) {}

  async assertPermission(
    session: ServerSession,
    action: 'create' | 'update' | 'delete',
  ): Promise<void> {
    const result = await auth.api.userHasPermission({
      body: {
        userId: getEffectiveUserId(session),
        permissions: { notes: [action] },
      },
    });
    if (result?.success !== true) {
      throw new ForbiddenException(
        action === 'delete'
          ? 'Only superAdmins can delete notes.'
          : `You do not have permission to ${action} notes.`,
      );
    }
  }

  async listForSession(
    session: ServerSession,
    limit = DEFAULT_LIMIT,
    offset = 0,
  ): Promise<{
    notes: SerializedNote[];
    viewerRole: string;
    total: number;
    limit: number;
    offset: number;
  }> {
    return withSpan('notes.list', async (span) => {
      span.setAttribute(AppAttributes.OPERATION, 'notes.list');
      span.setAttribute(AppAttributes.FEATURE, 'notes');
      span.setAttribute(AppAttributes.ENTITY_TYPE, 'note');

      try {
        const viewerRole = await this.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
        const canListAll = hasOperatorRole(viewerRole);

        const where = canListAll ? undefined : { authorId: session.user.id };
        const [notes, total] = await Promise.all([
          db.note.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: NOTE_INCLUDE,
            take: limit,
            skip: offset,
          }),
          db.note.count({ where }),
        ]);

        this.metricsService.recordNoteOperation('list', 'success');
        return {
          notes: notes.map(serialize),
          viewerRole,
          total,
          limit,
          offset,
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
        await this.assertPermission(session, 'create');

        const note = await db.note.create({
          data: {
            title: dto.title,
            content: dto.content,
            authorId: session.user.id,
          },
          include: NOTE_INCLUDE,
        });

        span.setAttribute(AppAttributes.ENTITY_ID, note.id);

        await this.writeAudit(session, 'note_created', meta, {
          noteId: note.id,
          title: note.title,
        });

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
        await this.assertPermission(session, 'update');

        if (!dto.title?.trim() && !dto.content?.trim()) {
          throw new BadRequestException('Nothing to update.');
        }

        const roleRaw = await this.getFreshRoleRaw(
          getEffectiveUserId(session),
        );
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
        let updated;
        try {
          updated = await db.note.update({
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

        await this.writeAudit(session, 'note_updated', meta, {
          noteId,
          title: dto.title || note.title,
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
        await this.assertPermission(session, 'delete');

        // Single atomic delete returning the title for the audit row (1 query
        // instead of findUnique + deleteMany). A missing row throws P2025,
        // mapped to 404 — no audit row for a deletion that never happened.
        let existing;
        try {
          existing = await db.note.delete({
            where: { id: noteId },
            select: { title: true },
          });
        } catch (err) {
          if (isRecordNotFoundError(err)) {
            throw new NotFoundException('Note not found.');
          }
          throw err;
        }

        await this.writeAudit(session, 'note_deleted', meta, {
          noteId,
          title: existing.title,
        });

        this.metricsService.recordNoteOperation('delete', 'success');
      } catch (err) {
        this.metricsService.recordNoteOperation('delete', 'failure');
        throw err;
      }
    });
  }

  /**
   * Fresh role straight from the DB (mirrors web's behaviour of never trusting
   * the possibly-stale session snapshot for authorization decisions).
   * Accepts either a full session or an explicit user id.
   */
  private async getFreshRoleRaw(
    sessionOrUserId: ServerSession | string,
  ): Promise<string> {
    const userId =
      typeof sessionOrUserId === 'string'
        ? sessionOrUserId
        : sessionOrUserId.user.id;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return (user?.role as string | null | undefined) ?? 'user';
  }

  private async writeAudit(
    session: ServerSession,
    action: string,
    meta: { ip: string | null; userAgent: string | null },
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditRow(session, { action, metadata }, meta);
  }
}
