import { db } from '@repo/database';
import { createAuthMiddleware, getSessionFromCtx, APIError } from 'better-auth/api';
import { getMaxRoleWeight } from '@repo/roles';

/**
 * Server-side hierarchy guard.
 *
 * Throws APIError('FORBIDDEN') — which Better Auth converts to a 403 — when
 * the authenticated actor attempts to modify/delete/ban/impersonate a target
 * user whose role weight is >= the actor's own role weight.
 *
 * Must be called inside a `before` hook (createAuthMiddleware).  Throwing
 * inside a before hook is the documented way to abort the request chain.
 * (see: better-auth.com/docs/concepts/hooks)
 */
export async function enforceRoleHierarchy(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  targetUserId: string,
): Promise<void> {
  const session = await getSessionFromCtx(ctx as any);
  await enforceRoleHierarchyWithSession(session, targetUserId);
}

/**
 * Single-session hierarchy guard (Tasks 1, 10).
 *
 * Before: every admin `before` hook called `getSessionFromCtx` AND
 * `enforceRoleHierarchy` (which called `getSessionFromCtx` again) = 2x
 * secondaryStorage GETs (Redis) + 2x target `findUnique` (handler refetched
 * for audit metadata). After: hooks resolve the session ONCE, pass it here,
 * and reuse the returned target row for audit metadata — 1x session, 1x user.
 *
 * Returns the target user so callers never refetch the same row. Session
 * role is used ONLY for hierarchy comparison here; enforcement elsewhere
 * still uses the fresh DB role. Freshness is preserved via
 * `invalidateUserCache` on every mutation.
 */
export async function enforceRoleHierarchyWithSession(
  session: unknown,
  targetUserId: string,
): Promise<{ id: string; email: string | null; role: string | null }> {
  if (!session) {
    throw new APIError('UNAUTHORIZED', { message: 'Authentication required.' });
  }

  const actorRole =
    (session as { user?: { role?: string } }).user?.role ?? 'user';
  const targetUser = await db.user
    .findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true },
    })
    .catch(() => null);
  if (!targetUser) {
    throw new APIError('NOT_FOUND', { message: 'Target user not found.' });
  }
  const targetRole = (targetUser?.role as string | null) ?? 'user';

  if (getMaxRoleWeight(targetRole) >= getMaxRoleWeight(actorRole)) {
    throw new APIError('FORBIDDEN', {
      message:
        'You do not have permission to perform this action on a user with equal or higher privileges.',
    });
  }
  return targetUser as { id: string; email: string | null; role: string | null };
}