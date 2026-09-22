import { db } from '@repo/database';
import {
  createAuthMiddleware,
  getSessionFromCtx,
  APIError,
  isAPIError,
} from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';
import { parseRoles, serializeRoles, getMaxRoleWeight } from '@repo/roles';
import { createLogger, AuthAttributes, trace } from '@repo/observability';
import { enforceRoleHierarchyWithSession } from './hierarchy';
import {
  invalidateUserCache,
  popPendingStopImpersonation,
  storePendingDeletion,
  storePendingStopImpersonation,
} from './pending-storage';
import { resolveClientIp } from '../shared/client-ip';

const logger = createLogger('auth:audit-plugin');

// ---------------------------------------------------------------------------
// Audit-log plugin — before guards + after success audit.
//
// Lifecycle (Better Auth 1.6.29, verified in dist/api/dispatch.mjs):
// - `before` hooks run BEFORE the endpoint. Throwing APIError aborts.
//   Used ONLY for guards (hierarchy, self-ban/delete, assign-guard) and
//   stashing old values. NEVER writes success audit or invalidates here.
// - `after` hooks run AFTER the endpoint even on APIError failure.
//   `ctx.context.returned` holds the endpoint result or APIError.
//   We skip audit+invalidation unless the mutation actually succeeded
//   (returned present, not APIError, not Response with non-200).
// - databaseHooks.user.update.before already stashes old rows for the
//   non-admin path; admin endpoints go through internalAdapter.updateUser
//   which also fires with-hooks, so cache invalidation here is the
//   authoritative post-commit step for admin mutations.
// ---------------------------------------------------------------------------

function isSuccess(ctx: unknown): boolean {
  const returned = (ctx as { context?: { returned?: unknown } })?.context
    ?.returned;
  if (!returned) return false;
  if (returned instanceof Response) return returned.status === 200;
  try {
    if (isAPIError(returned as never)) return false;
  } catch {
    return false;
  }
  return true;
}

function spanAction(action: string, userId: string): void {
  const activeSpan = trace.getActiveSpan();
  if (activeSpan?.isRecording()) {
    activeSpan.setAttribute(AuthAttributes.ACTION, action);
    activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
  }
}

async function writeAudit(data: {
  userId: string;
  action: string;
  actor?: string | null;
  ipAddress?: string;
  userAgent?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}): Promise<void> {
  await db.auditLog
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .create({ data: { ...data, actor: data.actor ?? undefined } as any })
    .catch((e: unknown) =>
      logger.error({ err: e, msg: `[AuditLog] ${data.action} failed` }),
    );
}

// Stash old role across before→after (same worker process; before+after for
// one request always run in the same process).
const pendingRoleChange = new Map<string, string>();
const pendingUpdateSnapshot = new Map<
  string,
  { role: string | null; banned: boolean | null; email: string | null }
>();
const pendingRevokeSingle = new Map<string, string>();

export const auditLogPlugin = (): BetterAuthPlugin => ({
  id: 'audit-log-plugin',
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === '/admin/set-role',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { userId?: string; role?: string | string[] }
            | undefined;
          const userId = body?.userId;
          const newRole = body?.role;
          if (!userId || !newRole) return;

          const session = await getSessionFromCtx(ctx as never);
          const oldUser = await enforceRoleHierarchyWithSession(session, userId);

          const actorRole =
            (session?.user as { role?: string })?.role ?? 'user';
          const actorWeight = getMaxRoleWeight(actorRole);
          const nextRoles = parseRoles(newRole);
          if (nextRoles.some((r) => getMaxRoleWeight(r) >= actorWeight)) {
            throw new APIError('FORBIDDEN', {
              message:
                'You cannot assign a role equal to or higher than your own.',
            });
          }

          const oldRole = serializeRoles(
            parseRoles(oldUser?.role as string | null),
          );
          const nextRoleJoined = serializeRoles(nextRoles);
          if (oldRole === nextRoleJoined) return;
          pendingRoleChange.set(userId, oldRole);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/ban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          const session = await getSessionFromCtx(ctx as never);
          const actorId = session?.user?.id;
          if (actorId && actorId === userId) {
            const ipAddress = resolveClientIp(ctx.headers);
            const userAgent = ctx.headers?.get('user-agent') ?? undefined;
            await writeAudit({
              userId,
              action: 'user_ban_blocked',
              actor: actorId,
              ipAddress,
              userAgent,
              metadata: { reason: 'self_ban_attempt' },
            });
            throw new APIError('BAD_REQUEST', {
              message: 'You cannot ban your own account.',
            });
          }
          await enforceRoleHierarchyWithSession(session, userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/unban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          const session = await getSessionFromCtx(ctx as never);
          await enforceRoleHierarchyWithSession(session, userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/revoke-user-sessions',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          const session = await getSessionFromCtx(ctx as never);
          await enforceRoleHierarchyWithSession(session, userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/revoke-user-session',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { sessionToken?: string } | undefined;
          const sessionToken = body?.sessionToken;
          if (!sessionToken) return;
          const session = await getSessionFromCtx(ctx as never);
          if (!session) {
            throw new APIError('UNAUTHORIZED', {
              message: 'Authentication required.',
            });
          }
          const target = await db.session
            .findUnique({
              where: { token: sessionToken },
              select: { userId: true },
            })
            .catch(() => null);
          if (!target) return;
          await enforceRoleHierarchyWithSession(session, target.userId);
          pendingRevokeSingle.set(sessionToken, target.userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/remove-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;
          const session = await getSessionFromCtx(ctx as never);
          const actorId = session?.user?.id;
          if (actorId && actorId === targetUserId) {
            const ipAddress = resolveClientIp(ctx.headers);
            const userAgent = ctx.headers?.get('user-agent') ?? undefined;
            await writeAudit({
              userId: targetUserId,
              action: 'user_delete_blocked',
              actor: actorId,
              ipAddress,
              userAgent,
              metadata: { reason: 'self_delete_attempt' },
            });
            throw new APIError('BAD_REQUEST', {
              message:
                'You cannot delete your own account via the admin panel.',
            });
          }
          await enforceRoleHierarchyWithSession(session, targetUserId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/impersonate-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;
          const session = await getSessionFromCtx(ctx as never);
          const currentImpersonatedBy = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;
          if (currentImpersonatedBy) {
            throw new APIError('FORBIDDEN', {
              message:
                'Cannot start impersonation while being impersonated. Stop current impersonation first.',
            });
          }
          await enforceRoleHierarchyWithSession(session, targetUserId);
        }),
      },
      {
        // Store stop-impersonation suppression BEFORE the endpoint.
        // The endpoint calls internalAdapter.deleteSession() which fires
        // databaseHooks.session.delete.before DURING the endpoint (see
        // better-auth with-hooks.mjs deleteWithHooks: before runs inline
        // before the row delete, plugin `after` hooks run only after
        // dispatch sets ctx.context.returned). Storing here guarantees the
        // pop in session.delete.before succeeds, so exactly one
        // `user_stop_impersonating` row is written (by the after hook below).
        // Storing in `after` (previous behavior) was too late and produced
        // two rows per successful stop.
        matcher: (ctx) => ctx.path === '/admin/stop-impersonating',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          const userId = session?.user?.id;
          const impersonatedBy = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;
          if (!userId || !impersonatedBy) return;
          await storePendingStopImpersonation(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/update-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { userId?: string; data?: Record<string, unknown> }
            | undefined;
          const userId = body?.userId;
          const data = body?.data;
          if (!userId || !data) return;
          const session = await getSessionFromCtx(ctx as never);
          const oldUser = await enforceRoleHierarchyWithSession(
            session,
            userId,
          );
          const full = await db.user
            .findUnique({
              where: { id: userId },
              select: { role: true, banned: true, email: true },
            })
            .catch(() => null);
          pendingUpdateSnapshot.set(userId, {
            role: (full?.role as string | null) ?? (oldUser?.role as string | null) ?? null,
            banned: (full?.banned as boolean | null) ?? null,
            email: (full?.email as string | null) ?? oldUser?.email ?? null,
          });
          if (
            Object.prototype.hasOwnProperty.call(data, 'role') &&
            data.role !== undefined
          ) {
            const actorRole =
              (session?.user as { role?: string })?.role ?? 'user';
            const actorWeight = getMaxRoleWeight(actorRole);
            const nextRoles = parseRoles(data.role);
            if (nextRoles.some((r) => getMaxRoleWeight(r) >= actorWeight)) {
              throw new APIError('FORBIDDEN', {
                message:
                  'You cannot assign a role equal to or higher than your own.',
              });
            }
          }
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/create-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { role?: string | string[] }
            | undefined;
          const role = body?.role;
          if (role === undefined) return;
          const session = await getSessionFromCtx(ctx as never);
          if (!session) {
            throw new APIError('UNAUTHORIZED', {
              message: 'Authentication required.',
            });
          }
          const actorRole =
            (session?.user as { role?: string })?.role ?? 'user';
          const actorWeight = getMaxRoleWeight(actorRole);
          const nextRoles = parseRoles(role);
          if (nextRoles.some((r) => getMaxRoleWeight(r) >= actorWeight)) {
            throw new APIError('FORBIDDEN', {
              message:
                'You cannot create a user with a role equal to or higher than your own.',
            });
          }
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/set-user-password',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          const session = await getSessionFromCtx(ctx as never);
          await enforceRoleHierarchyWithSession(session, userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/delete-user',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as never);
          if (!session?.user?.id) return;
          const userId = session.user.id;
          const currentSession = (
            session as {
              session?: { token?: string | null; id?: string | null };
            }
          ).session;
          const body = ctx.body as { password?: string } | undefined;
          const accounts = await db.account.findMany({
            where: { userId },
            select: { providerId: true },
          });
          const hasCredentialAccount = accounts.some(
            (acc) => acc.providerId === 'credential',
          );
          if (hasCredentialAccount && !body?.password) {
            throw new APIError('BAD_REQUEST', {
              message: 'Password is required to confirm account deletion.',
            });
          }
          const targetUser = await db.user
            .findUnique({ where: { id: userId }, select: { email: true } })
            .catch(() => null);
          await storePendingDeletion(userId, {
            ipAddress: resolveClientIp(ctx.headers) ?? null,
            userAgent: ctx.headers?.get('user-agent') ?? null,
            email: targetUser?.email ?? null,
            sessionToken: currentSession?.token ?? null,
            sessionId: currentSession?.id ?? null,
          });
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => ctx.path === '/admin/set-role',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { userId?: string; role?: string | string[] }
            | undefined;
          const userId = body?.userId;
          if (!isSuccess(ctx)) {
            if (userId) pendingRoleChange.delete(userId);
            return;
          }
          if (!userId) return;
          const nextRoleJoined = serializeRoles(parseRoles(body?.role));
          const oldRole = pendingRoleChange.get(userId) ?? 'user';
          pendingRoleChange.delete(userId);
          if (oldRole === nextRoleJoined) return;
          spanAction('role_changed', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'role_changed',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: { from: oldRole, to: nextRoleJoined },
          });
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/ban-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as
            | { userId?: string; banReason?: string }
            | undefined;
          const userId = body?.userId;
          if (!userId) return;
          spanAction('user_banned', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'user_banned',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: { reason: body?.banReason ?? null },
          });
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/unban-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          spanAction('user_unbanned', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'user_unbanned',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
          });
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/revoke-user-sessions',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          spanAction('sessions_revoked', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'sessions_revoked',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
          });
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/revoke-user-session',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) {
            const t = (ctx.body as { sessionToken?: string } | undefined)
              ?.sessionToken;
            if (t) pendingRevokeSingle.delete(t);
            return;
          }
          const body = ctx.body as { sessionToken?: string } | undefined;
          const sessionToken = body?.sessionToken;
          if (!sessionToken) return;
          const userId = pendingRevokeSingle.get(sessionToken) ?? null;
          pendingRevokeSingle.delete(sessionToken);
          if (!userId) return;
          spanAction('session_revoked', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'session_revoked',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: { sessionToken: '[redacted]' },
          });
          await invalidateUserCache(userId, { sessionToken });
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/remove-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;
          spanAction('user_deleted', targetUserId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId: targetUserId,
            action: 'user_deleted',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
          });
          await invalidateUserCache(targetUserId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/impersonate-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;
          spanAction('user_impersonation_started', targetUserId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          const targetUser = await db.user
            .findUnique({
              where: { id: targetUserId },
              select: { email: true },
            })
            .catch(() => null);
          await writeAudit({
            userId: targetUserId,
            action: 'user_impersonation_started',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: { targetEmail: targetUser?.email ?? null },
          });
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/update-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) {
            const uid = (ctx.body as { userId?: string } | undefined)?.userId;
            if (uid) pendingUpdateSnapshot.delete(uid);
            return;
          }
          const body = ctx.body as
            | { userId?: string; data?: Record<string, unknown> }
            | undefined;
          const userId = body?.userId;
          if (!userId) return;
          const old = pendingUpdateSnapshot.get(userId) ?? null;
          pendingUpdateSnapshot.delete(userId);
          spanAction('user_updated', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;
          const fresh = await db.user
            .findUnique({
              where: { id: userId },
              select: { role: true, banned: true, email: true },
            })
            .catch(() => null);
          const changedKeys = Object.keys(body?.data ?? {});
          await writeAudit({
            userId,
            action: 'user_updated',
            actor: session?.user?.id,
            ipAddress,
            userAgent,
            metadata: {
              changedKeys,
              ...(old?.role !== undefined &&
              fresh?.role !== undefined &&
              old?.role !== fresh?.role
                ? { from: old?.role ?? null, to: fresh?.role ?? null }
                : {}),
            },
          });
          if (old && fresh) {
            if ((old.role ?? null) !== (fresh.role ?? null)) {
              await writeAudit({
                userId,
                action: 'role_changed',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
                metadata: {
                  from: old.role ?? 'user',
                  to: fresh.role ?? 'user',
                  via: 'admin_update_user',
                },
              });
            }
            if (!old.banned && fresh.banned) {
              await writeAudit({
                userId,
                action: 'user_banned',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
                metadata: { via: 'admin_update_user' },
              });
            }
            if (old.banned && !fresh.banned) {
              await writeAudit({
                userId,
                action: 'user_unbanned',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
                metadata: { via: 'admin_update_user' },
              });
            }
          }
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/create-user',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const returned = (ctx as { context?: { returned?: unknown } })
            ?.context?.returned as
            | { user?: { id?: string; email?: string } }
            | null;
          const body = ctx.body as
            | { email?: string; name?: string; role?: string | string[] }
            | undefined;
          const newUserId =
            returned?.user?.id ??
            (
              await db.user
                .findUnique({
                  where: { email: body?.email ?? '' },
                  select: { id: true },
                })
                .catch(() => null)
            )?.id ??
            null;
          if (!newUserId) return;
          spanAction('user_created', newUserId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId: newUserId,
            action: 'user_created',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: {
              email: returned?.user?.email ?? body?.email ?? null,
              role: serializeRoles(parseRoles(body?.role ?? 'user')),
            },
          });
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/set-user-password',
        handler: createAuthMiddleware(async (ctx) => {
          if (!isSuccess(ctx)) return;
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;
          spanAction('password_changed', userId);
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          await writeAudit({
            userId,
            action: 'password_changed',
            actor: session?.user?.id,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
            metadata: { via: 'admin_set_password' },
          });
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/stop-impersonating',
        handler: createAuthMiddleware(async (ctx) => {
          // The suppression flag was stored by the `before` hook above.
          // On failure the endpoint never called deleteSession(), so no
          // session.delete.before consumed the flag — pop it here to avoid a
          // stale 15s suppression window that could swallow a subsequent
          // legitimate `user_signed_out` audit for the same user.
          if (!isSuccess(ctx)) {
            const failedSession = await getSessionFromCtx(ctx as never).catch(
              () => null,
            );
            const failedUserId = failedSession?.user?.id;
            if (failedUserId) await popPendingStopImpersonation(failedUserId);
            return;
          }
          const session = await getSessionFromCtx(ctx as never).catch(
            () => null,
          );
          const userId = session?.user?.id;
          if (!userId) return;
          const actorId = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;
          if (!actorId) return;
          spanAction('user_stop_impersonating', userId);
          await writeAudit({
            userId,
            action: 'user_stop_impersonating',
            actor: actorId,
            ipAddress: resolveClientIp(ctx.headers),
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
          });
        }),
      },
    ],
  },
});
