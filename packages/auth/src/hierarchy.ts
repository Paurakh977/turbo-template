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
  const session = await getSessionFromCtx(ctx);
  if (!session) {
    throw new APIError('UNAUTHORIZED', { message: 'Authentication required.' });
  }

  const actorRole = (session.user as { role?: string }).role ?? 'user';
  const targetUser = await db.user
    .findUnique({ where: { id: targetUserId } })
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
}