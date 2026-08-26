import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { db } from '@repo/database';
import { auth } from '@repo/auth';

import type { ServerSession } from '../common/session.utils';
import {
  getEffectiveUserId,
  hasAdminRole,
  hasOperatorRole,
} from '../common/session.utils';
import { writeAuditRow } from '../common/audit-writer';
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
    const viewerRole = await this.getFreshRoleRaw(getEffectiveUserId(session));
    // Visibility parity with the pre-migration implementation: the
    // `notes.list` permission (operator and above) grants the full note
    // list; plain users only ever see their own. Admin (and above) is a
    // STRICTER bar reserved for the edit-others bypass below.
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
    return { notes: notes.map(serialize), viewerRole, total, limit, offset };
  }

  async create(
    session: ServerSession,
    dto: CreateNoteDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<SerializedNote> {
    await this.assertPermission(session, 'create');

    const note = await db.note.create({
      data: { title: dto.title, content: dto.content, authorId: session.user.id },
      include: NOTE_INCLUDE,
    });

    await this.writeAudit(session, 'note_created', meta, {
      noteId: note.id,
      title: note.title,
    });

    return serialize(note);
  }

  async update(
    session: ServerSession,
    noteId: string,
    dto: UpdateNoteDto,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<SerializedNote> {
    await this.assertPermission(session, 'update');

    // An empty (or whitespace-only) patch would bump updatedAt - and write an
    // audit row - while changing nothing. Emptiness is decided on trimmed
    // values; what gets persisted stays verbatim.
    if (!dto.title?.trim() && !dto.content?.trim()) {
      throw new BadRequestException('Nothing to update.');
    }

    const roleRaw = await this.getFreshRoleRaw(getEffectiveUserId(session));
    const isAdmin = hasAdminRole(roleRaw);

    // Full row up front: doubles as the ownership check AND the fallback
    // payload if a concurrent delete wins right after our write commits.
    const note = await db.note.findUnique({
      where: { id: noteId },
      include: NOTE_INCLUDE,
    });
    if (!note) throw new NotFoundException('Note not found.');
    if (!isAdmin && note.authorId !== session.user.id) {
      throw new ForbiddenException('You can only edit your own notes.');
    }

    // Conditional bulk write instead of findUnique -> update: a concurrent
    // delete BEFORE our write deterministically yields count 0 (mapped to a
    // clean 404 below) instead of raw Prisma P2025 surfacing as a 500.
    const updated = await db.note.updateMany({
      where: { id: noteId },
      data: {
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.content ? { content: dto.content } : {}),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Note not found.');
    }

    await this.writeAudit(session, 'note_updated', meta, {
      noteId,
      title: dto.title || note.title,
    });

    // Refetch for authoritative post-update values. If a concurrent delete
    // lands between the committed write and this read, the UPDATE still
    // happened — answer with a best-effort payload instead of lying with a
    // 404 or skipping the audit row.
    const fresh = await db.note.findUnique({
      where: { id: noteId },
      include: NOTE_INCLUDE,
    });
    if (fresh) return serialize(fresh);
    return serialize({
      ...note,
      ...(dto.title ? { title: dto.title } : {}),
      ...(dto.content ? { content: dto.content } : {}),
      updatedAt: new Date(),
    });
  }

  async remove(
    session: ServerSession,
    noteId: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    await this.assertPermission(session, 'delete');

    const existing = await db.note.findUnique({
      where: { id: noteId },
      select: { title: true },
    });
    if (!existing) throw new NotFoundException('Note not found.');

    const deleted = await db.note.deleteMany({ where: { id: noteId } });
    if (deleted.count === 0) throw new NotFoundException('Note not found.');

    await this.writeAudit(session, 'note_deleted', meta, {
      noteId,
      title: existing.title,
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

