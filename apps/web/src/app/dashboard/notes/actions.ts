'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { callInternalApi } from '../../../lib/server/internal-api';
import {
  classifyApiError,
  toActionError,
} from '../../../lib/server/api-errors';
import { getRequestBootstrap } from '../../../lib/server/bootstrap';
import {
  checkServerActionRateLimit,
  getServerActionRateLimitMessage,
} from '../../../lib/server/server-action-rate-limit';

type NoteActionError = { error: string };

/**
 * Single-bootstrap identity: ONE HTTP (`/me/bootstrap`) replaces
 * `getSessionFromApi + getMyPermissions` (2 HTTP, 2 session lookups).
 * Returns headers + permissions for rate-limit + UI gating.
 * The domain mutation re-enforces authz server-side — this early check is
 * UX-only and never trusted for security.
 *
 * Bootstrap + rate-check run in PARALLEL: the limiter derives its
 * bucket from the session server-side, so neither request needs the other's
 * result. Saves ~1 wall RTT per mutation (HTTP count unchanged — a full
 * merge into a domain guard is deferred, see plan §5/ISSUE 3).
 */
async function getBootstrapAndRateLimit(action: string, windowMs: number, max: number) {
  const h = await headers();
  let bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>> | null = null;
  let bootstrapError: unknown = null;
  try {
    bootstrap = await getRequestBootstrap(h);
  } catch (error) {
    bootstrapError = error;
  }
  const rate = await checkServerActionRateLimit({
    scope: `notes:${action}`,
    windowMs,
    max,
    failOpen: false,
  });
  return { h, bootstrap, bootstrapError, rate };
}

function redirectIfUnauthenticated(
  bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>> | null,
  bootstrapError?: unknown,
): asserts bootstrap is NonNullable<typeof bootstrap> & { userId: string } {
  // 401 (or null bootstrap from 401) → login. Anything else (503/504/timeout)
  // must NOT become a login redirect — throw so the action returns a service
  // error instead.
  if (bootstrap?.userId) return;
  if (bootstrapError !== null && bootstrapError !== undefined) {
    const kind = classifyApiError(bootstrapError);
    if (kind !== 'unauthorized') throw bootstrapError;
  }
  redirect('/auth');
}

function rateLimitError(
  rate: Awaited<ReturnType<typeof checkServerActionRateLimit>>,
) {
  if (!rate.allowed) {
    return { error: getServerActionRateLimitMessage(rate.retryAfterMs) };
  }
  return null;
}

export async function createNoteAction(formData: FormData) {
  const { h, bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'create-note',
    60_000,
    10,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { permissions } = bootstrap;

  // Verdicts are computed by the API for the EFFECTIVE user (impersonation
  // aware) - no client-supplied user id involved.
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
      requestHeaders: h,
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
    return toNoteActionError(error, 'Could not create the note. Please try again.');
  }
}

export async function updateNoteAction(noteId: string, formData: FormData) {
  const { h, bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'update-note',
    60_000,
    20,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { permissions } = bootstrap;

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
      requestHeaders: h,
    });
  } catch (error) {
    return toNoteActionError(error, 'Could not update the note.');
  }

  revalidatePath('/dashboard/notes');
  return { success: true };
}

export async function deleteNoteAction(noteId: string) {
  const { h, bootstrap, bootstrapError, rate } = await getBootstrapAndRateLimit(
    'delete-note',
    60_000,
    10,
  );
  redirectIfUnauthenticated(bootstrap, bootstrapError);
  const limited = rateLimitError(rate);
  if (limited) return limited;
  const { permissions } = bootstrap;

  if (!permissions.notes.includes('delete')) {
    return { error: 'You do not have permission to delete notes.' };
  }

  try {
    await callInternalApi(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
      requestHeaders: h,
    });
  } catch (error) {
    return toNoteActionError(error, 'Could not delete the note.');
  }

  revalidatePath('/dashboard/notes');
  return { success: true };
}

function toNoteActionError(error: unknown, fallback: string): NoteActionError {
  return toActionError(error, fallback);
}
