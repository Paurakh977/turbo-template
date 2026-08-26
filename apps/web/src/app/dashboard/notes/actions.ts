'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionFromApi } from '../../../lib/server/auth-http';
import {
  callInternalApi,
  getMyPermissionsFromApi,
} from '../../../lib/server/internal-api';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server-action-rate-limit';

type NoteActionError = { error: string };

async function getSessionOrRedirect() {
  const h = await headers();
  const session = await getSessionFromApi(h);
  if (!session) redirect('/auth');
  return session;
}

async function enforceActionRateLimit(
  userId: string,
  action: string,
  windowMs: number,
  max: number,
) {
  const result = await checkServerActionRateLimit({
    scope: `notes:${action}`,
    identifier: userId,
    windowMs,
    max,
    failOpen: false,
  });

  if (!result.allowed) {
    return { error: getServerActionRateLimitMessage(result.retryAfterMs) };
  }

  return null;
}

export async function createNoteAction(formData: FormData) {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'create-note',
    60_000,
    10,
  );
  if (rateLimitError) return rateLimitError;

  // Verdicts are computed by the API for the EFFECTIVE user (impersonation
  // aware) - no client-supplied user id involved.
  const { permissions } = await getMyPermissionsFromApi();
  if (!permissions.notes.includes('create')) {
    return { error: 'Only operators and above can create notes.' };
  }

  const title = ((formData.get('title') as string) ?? '').trim();
  const content = ((formData.get('content') as string) ?? '').trim();

  if (!title || title.length > 200)
    return { error: 'Title is required (max 200 chars).' };
  if (!content || content.length > 5000)
    return { error: 'Content is required (max 5000 chars).' };

  try {
    const note = await callInternalApi<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
    }>('/api/notes', {
      method: 'POST',
      body: { title, content },
      requestHeaders: await headers(),
    });

    // Audit row is written by the API tier alongside the mutation.

    revalidatePath('/dashboard/notes');
    return {
      success: true,
      note: {
        ...note,
      },
    };
  } catch (error) {
    console.error('[Notes] create failed:', error);
    return { error: 'Could not create the note. Please try again.' };
  }
}

export async function updateNoteAction(noteId: string, formData: FormData) {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'update-note',
    60_000,
    20,
  );
  if (rateLimitError) return rateLimitError;

  const { permissions } = await getMyPermissionsFromApi();
  if (!permissions.notes.includes('update')) {
    return { error: 'You do not have permission to update notes.' };
  }

  const title = ((formData.get('title') as string) ?? '').trim();
  const content = ((formData.get('content') as string) ?? '').trim();

  if (title && title.length > 200) return { error: 'Title max 200 chars.' };
  if (content && content.length > 5000)
    return { error: 'Content max 5000 chars.' };

  try {
    // Ownership rule (author-only unless admin) is enforced by the API.
    await callInternalApi(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: {
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
      },
      requestHeaders: await headers(),
    });
  } catch (error) {
    return toActionError(error, 'Could not update the note.');
  }

  revalidatePath('/dashboard/notes');
  return { success: true };
}

export async function deleteNoteAction(noteId: string) {
  const session = await getSessionOrRedirect();
  const rateLimitError = await enforceActionRateLimit(
    session.user.id,
    'delete-note',
    60_000,
    10,
  );
  if (rateLimitError) return rateLimitError;

  const { permissions } = await getMyPermissionsFromApi();
  if (!permissions.notes.includes('delete')) {
    return { error: 'You do not have permission to delete notes.' };
  }

  try {
    await callInternalApi(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
      requestHeaders: await headers(),
    });
  } catch (error) {
    return toActionError(error, 'Could not delete the note.');
  }

  revalidatePath('/dashboard/notes');
  return { success: true };
}

function toActionError(error: unknown, fallback: string): NoteActionError {
  // APIError instances carry a human message from the API tier
  // (NotFound -> "Note not found.", Forbidden -> ownership message).
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message
  ) {
    return { error: (error as { message: string }).message };
  }
  return { error: fallback };
}
