import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { db } from '@repo/database';
import { auth } from '@repo/auth';

import type { ServerSession } from '../common/session.utils';
import {
  getEffectiveUserId,
  getSessionRoleRaw,
  hasAdminRole,
} from '../common/session.utils';
import { CreateNoteDto, UpdateNoteDto } from './dto/note.dto';

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

  async listForSession(session: ServerSession): Promise<SerializedNote[]> {
    const roleRaw = await this.getFreshRoleRaw(session);
    const canListAll = hasAdminRole(roleRaw);

    const notes = await db.note.findMany({
      where: canListAll ? undefined : { authorId: session.user.id },
      orderBy: { createdAt: 'desc' },
      include: NOTE_INCLUDE,
    });
    return notes.map(serialize);
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

    const note = await db.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');

    const roleRaw = await this.getFreshRoleRaw(getEffectiveUserId(session));
    if (!hasAdminRole(roleRaw) && note.authorId !== session.user.id) {
      throw new ForbiddenException('You can only edit your own notes.');
    }

    const updated = await db.note.update({
      where: { id: noteId },
      data: {
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.content ? { content: dto.content } : {}),
      },
      include: NOTE_INCLUDE,
    });

    await this.writeAudit(session, 'note_updated', meta, {
      noteId,
      title: dto.title || note.title,
    });

    return serialize(updated);
  }

  async remove(
    session: ServerSession,
    noteId: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    await this.assertPermission(session, 'delete');

    const note = await db.note.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found.');

    await db.note.delete({ where: { id: noteId } });

    await this.writeAudit(session, 'note_deleted', meta, {
      noteId,
      title: note.title,
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
    const impersonatedBy =
      (session as { session?: { impersonatedBy?: string | null } }).session
        ?.impersonatedBy ?? null;

    // Prisma's generated JSON input type is stricter than our metadata shape;
    // the payload is plain JSON-safe values by construction.
    type AuditCreateData = NonNullable<
      Parameters<typeof db.auditLog.create>[0]
    >['data'];
    const data = {
      userId: session.user.id,
      action,
      actor: impersonatedBy ?? undefined,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      metadata: (impersonatedBy
        ? { ...metadata, performedViaImpersonation: true, impersonatedBy }
        : metadata) as AuditCreateData extends { metadata?: infer M }
        ? M
        : never,
    };

    try {
      await db.auditLog.create({ data });
    } catch (error) {
      console.error(`[AuditLog] ${action} failed:`, error);
    }
  }
}

// Re-exported for controller-level reuse without leaking Prisma types.
export { getSessionRoleRaw };
