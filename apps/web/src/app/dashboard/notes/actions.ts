'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@repo/database';
import { auth, hasAdminRole } from '@repo/auth';

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');
  return session;
}

async function logAudit(
  userId: string,
  action: string,
  metadata?: Record<string, unknown>,
) {
  try {
    const h = await headers();
    await db.auditLog.create({
      data: {
        userId,
        action,
        ipAddress: h.get('x-forwarded-for') ?? null,
        userAgent: h.get('user-agent') ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: metadata as any,
      },
    });
  } catch (e) {
    console.error(`[AuditLog] ${action} failed:`, e);
  }
}

export async function createNoteAction(formData: FormData) {
  const session = await getSessionOrRedirect();

  const perm = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { notes: ['create'] } },
  });
  if (!perm?.success) {
    return { error: 'Only operators and above can create notes.' };
  }

  const title = ((formData.get('title') as string) ?? '').trim();
  const content = ((formData.get('content') as string) ?? '').trim();

  if (!title || title.length > 200)
    return { error: 'Title is required (max 200 chars).' };
  if (!content || content.length > 5000)
    return { error: 'Content is required (max 5000 chars).' };

  const note = await db.note.create({
    data: { title, content, authorId: session.user.id },
  });

  await logAudit(session.user.id, 'note_created', { noteId: note.id, title });

  revalidatePath('/dashboard/notes');
  return { success: true };
}

export async function updateNoteAction(noteId: string, formData: FormData) {
  const session = await getSessionOrRedirect();

  const perm = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { notes: ['update'] } },
  });
  if (!perm?.success) {
    return { error: 'You do not have permission to update notes.' };
  }

  const note = await db.note.findUnique({ where: { id: noteId } });
  if (!note) return { error: 'Note not found.' };

  const userFromDb = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  const roleRaw = (userFromDb?.role as string | null | undefined) ?? 'user';
  const isAdmin = hasAdminRole(roleRaw);
  if (!isAdmin && note.authorId !== session.user.id) {
    return { error: 'You can only edit your own notes.' };
  }

  const title = ((formData.get('title') as string) ?? '').trim();
  const content = ((formData.get('content') as string) ?? '').trim();

  if (title && title.length > 200) return { error: 'Title max 200 chars.' };
  if (content && content.length > 5000)
    return { error: 'Content max 5000 chars.' };

  await db.note.update({
    where: { id: noteId },
    data: {
      ...(title && { title }),
      ...(content && { content }),
    },
  });

  await logAudit(session.user.id, 'note_updated', {
    noteId,
    title: title || note.title,
  });

  revalidatePath('/dashboard/notes');
  return { success: true };
}

export async function deleteNoteAction(noteId: string) {
  const session = await getSessionOrRedirect();

  const perm = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { notes: ['delete'] } },
  });
  if (!perm?.success) {
    return { error: 'Only superAdmins can delete notes.' };
  }

  const note = await db.note
    .findUnique({ where: { id: noteId } })
    .catch(() => null);

  await db.note.delete({ where: { id: noteId } });

  await logAudit(session.user.id, 'note_deleted', {
    noteId,
    title: note?.title ?? null,
  });

  revalidatePath('/dashboard/notes');
  return { success: true };
}
