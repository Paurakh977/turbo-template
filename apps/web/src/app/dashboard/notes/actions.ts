'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@repo/database';
import { auth } from '@repo/auth';

// ---------------------------------------------------------------------------
// Server Actions for Notes
//
// Pattern: auth.api.getSession  → auth.api.userHasPermission → DB operation
// Better Auth handles all auth. Server Actions run on the server and are
// NOT exposed as HTTP endpoints — no custom route handlers needed.
// ---------------------------------------------------------------------------

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');
  return session;
}

// ── Create note (operator+) ─────────────────────────────────────────────────
export async function createNoteAction(formData: FormData) {
  const session = await getSessionOrRedirect();

  const perm = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { notes: ['create'] } },
  });
  if (!perm?.success) {
    return { error: 'Only operators and above can create notes.' };
  }

  const title   = (formData.get('title')   as string ?? '').trim();
  const content = (formData.get('content') as string ?? '').trim();

  if (!title   || title.length   > 200) return { error: 'Title is required (max 200 chars).' };
  if (!content || content.length > 5000) return { error: 'Content is required (max 5000 chars).' };

  await db.note.create({
    data: { title, content, authorId: session.user.id },
  });

  revalidatePath('/dashboard/notes');
  return { success: true };
}

// ── Update note (operator+ AND must be author, OR admin+) ───────────────────
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

  // Operators can only edit their own notes; admins can edit any
  const isAdmin = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { user: ['list'] } },
  });
  if (!isAdmin?.success && note.authorId !== session.user.id) {
    return { error: 'You can only edit your own notes.' };
  }

  const title   = (formData.get('title')   as string ?? '').trim();
  const content = (formData.get('content') as string ?? '').trim();

  if (title   && title.length   > 200) return { error: 'Title max 200 chars.' };
  if (content && content.length > 5000) return { error: 'Content max 5000 chars.' };

  await db.note.update({
    where: { id: noteId },
    data: {
      ...(title   && { title }),
      ...(content && { content }),
    },
  });

  revalidatePath('/dashboard/notes');
  return { success: true };
}

// ── Delete note (admin+ only) ───────────────────────────────────────────────
export async function deleteNoteAction(noteId: string) {
  const session = await getSessionOrRedirect();

  const perm = await auth.api.userHasPermission({
    body: { userId: session.user.id, permissions: { notes: ['delete'] } },
  });
  if (!perm?.success) {
    return { error: 'Only admins can delete notes.' };
  }

  await db.note.delete({ where: { id: noteId } });
  revalidatePath('/dashboard/notes');
  return { success: true };
}
