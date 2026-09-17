import { db } from '@repo/database';
import { createAuthMiddleware, getSessionFromCtx, APIError } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';
import { parseRoles, serializeRoles, getMaxRoleWeight } from '@repo/roles';
import { createLogger, AuthAttributes, trace } from '@repo/observability';
import {
  enforceRoleHierarchy,
} from './hierarchy';
import {
  invalidateUserCache,
  storePendingDeletion,
  storePendingStopImpersonation,
} from './pending-storage';
import { resolveClientIp } from '../shared/client-ip';

const logger = createLogger('auth:audit-plugin');

// ---------------------------------------------------------------------------
// Audit-log plugin
//
// Better Auth's admin plugin calls the DB adapter directly, bypassing
// databaseHooks.user.update. We intercept admin endpoints at the HTTP layer
// instead — this is the documented/correct pattern per the Better Auth hooks
// and plugin-creation docs.
//
// We use `before` hooks (not `after`) because:
//   1. We need the old value BEFORE the change (e.g., old role).
//   2. Fetching in a `before` hook and writing the log is atomic enough for
//      an audit trail — if the main operation later fails the entry will
//      note the intent, which is still useful.
// ---------------------------------------------------------------------------
export const auditLogPlugin = (): BetterAuthPlugin => ({
  id: 'audit-log-plugin',
  hooks: {
    before: [
      {
        // Intercept role changes made via the admin panel
        matcher: (ctx) => ctx.path === '/admin/set-role',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { userId?: string; role?: string | string[] }
            | undefined;
          const userId = body?.userId;
          const newRole = body?.role;

          if (!userId || !newRole) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'role_changed');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
          }

          // 🔒 HIERARCHY GUARD — actor cannot change the role of a peer/superior.
          await enforceRoleHierarchy(ctx, userId);

          // 🔒 Also prevent assigning a role HIGHER than the actor's own role.
          const session = await getSessionFromCtx(ctx as any);
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

          const oldUser = await db.user
            .findUnique({ where: { id: userId } })
            .catch(() => null);
          const oldRoles = parseRoles(
            oldUser?.role as string | string[] | null | undefined,
          );
          const oldRole = serializeRoles(oldRoles);
          const nextRoleJoined = serializeRoles(nextRoles);

          if (oldRole === nextRoleJoined) return;

          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          await db.auditLog
            .create({
              data: {
                userId,
                action: 'role_changed',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
                metadata: { from: oldRole, to: nextRoleJoined },
              },
            })
            .catch((e: unknown) =>
              logger.error({ err: e, msg: '[AuditLog] role_changed failed' }),
            );

          // Force cache invalidation so the new role is fetched instantly
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/ban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as
            | { userId?: string; banReason?: string }
            | undefined;
          const userId = body?.userId;
          if (!userId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'user_banned');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
          }

          const session = await getSessionFromCtx(ctx as any);
          const actorId = session?.user?.id;
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          // 🔒 SELF-BAN DENY — must THROW, not return. Per the Better Auth
          // hooks docs, only `throw new APIError(...)` aborts the endpoint
          // chain; returning (even after logging) lets the ban proceed.
          // Mirrors the framework's own YOU_CANNOT_BAN_YOURSELF guard in
          // better-auth/src/plugins/admin/routes.ts (BAD_REQUEST), checked
          // here first so the error message names the real problem instead
          // of the hierarchy guard's misleading privilege error (self always
          // has weight >= self). The blocked attempt is audited under a
          // distinct action so it can never be mistaken for a completed ban.
          if (actorId && actorId === userId) {
            await db.auditLog
              .create({
                data: {
                  userId,
                  action: 'user_ban_blocked',
                  actor: actorId,
                  ipAddress,
                  userAgent,
                  metadata: { reason: 'self_ban_attempt' },
                },
              })
              .catch((e: unknown) =>
                logger.error({ err: e, msg: '[AuditLog] user_ban_blocked failed' }),
              );
            throw new APIError('BAD_REQUEST', {
              message: 'You cannot ban your own account.',
            });
          }

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          await db.auditLog
            .create({
              data: {
                userId,
                action: 'user_banned',
                actor: actorId,
                ipAddress,
                userAgent,
                metadata: { reason: body?.banReason ?? null },
              },
            })
            .catch((e: unknown) =>
              logger.error({ err: e, msg: '[AuditLog] user_banned failed' }),
            );

          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/unban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'user_unbanned');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
          }

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          const session = await getSessionFromCtx(ctx as any);
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          await db.auditLog
            .create({
              data: {
                userId,
                action: 'user_unbanned',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
              },
            })
            .catch((e: unknown) =>
              logger.error({ err: e, msg: '[AuditLog] user_unbanned failed' }),
            );

          await invalidateUserCache(userId);
        }),
      },
      {
        // Intercept session revoke (admin revokes all user sessions)
        matcher: (ctx) => ctx.path === '/admin/revoke-user-sessions',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'sessions_revoked');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
          }

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          const session = await getSessionFromCtx(ctx as any);
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          await db.auditLog
            .create({
              data: {
                userId,
                action: 'sessions_revoked',
                actor: session?.user?.id,
                ipAddress,
                userAgent,
              },
            })
            .catch((e: unknown) =>
              logger.error({ err: e, msg: '[AuditLog] sessions_revoked failed' }),
            );

          await invalidateUserCache(userId);
        }),
      },
      {
        // Intercept user delete (admin hard deletes a user)
        matcher: (ctx) => ctx.path === '/admin/remove-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'user_deleted');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, targetUserId);
          }

          const session = await getSessionFromCtx(ctx as any);
          const actorId = session?.user?.id;
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          // 🔒 SELF-DELETE DENY — must THROW, not return. Unlike ban-user,
          // Better Auth has NO native self-delete guard on /admin/remove-user,
          // so a bare `return` here would let an admin hard-delete their own
          // account (only `throw new APIError(...)` aborts a before hook).
          // Checked before the hierarchy guard so the message names the real
          // problem. Audited under a distinct action; no cache invalidation
          // (nothing changed).
          if (actorId && actorId === targetUserId) {
            await db.auditLog
              .create({
                data: {
                  userId: targetUserId,
                  action: 'user_delete_blocked',
                  actor: actorId,
                  ipAddress,
                  userAgent,
                  metadata: { reason: 'self_delete_attempt' },
                },
              })
              .catch((e: unknown) =>
                logger.error({
                  err: e,
                  msg: '[AuditLog] user_delete_blocked failed',
                }),
              );
            throw new APIError('BAD_REQUEST', {
              message:
                'You cannot delete your own account via the admin panel.',
            });
          }

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, targetUserId);

          const targetUser = await db.user
            .findUnique({ where: { id: targetUserId } })
            .catch(() => null);

          await db.auditLog
            .create({
              data: {
                userId: targetUserId,
                action: 'user_deleted',
                actor: actorId,
                ipAddress,
                userAgent,
                metadata: { email: targetUser?.email ?? null },
              },
            })
            .catch((e: unknown) =>
              logger.error({ err: e, msg: '[AuditLog] user_deleted failed' }),
            );

          await invalidateUserCache(targetUserId);
        }),
      },
      {
        // Intercept impersonation — superAdmins may impersonate admins,
        // but admins cannot impersonate other admins or superAdmins.
        // Also block nested impersonation (impersonating while already being impersonated).
        matcher: (ctx) => ctx.path === '/admin/impersonate-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const targetUserId = body?.userId;
          if (!targetUserId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'user_impersonation_started');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, targetUserId);
          }

          // Get session and check if already being impersonated
          const session = await getSessionFromCtx(ctx as any);
          const currentImpersonatedBy = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;

          // 🔒 BLOCK NESTED IMPERSONATION - cannot impersonate while already being impersonated
          if (currentImpersonatedBy) {
            throw new APIError('FORBIDDEN', {
              message:
                'Cannot start impersonation while being impersonated. Stop current impersonation first.',
            });
          }

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, targetUserId);

          const actorId = session?.user?.id;
          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          const targetUser = await db.user
            .findUnique({ where: { id: targetUserId } })
            .catch(() => null);

          await db.auditLog
            .create({
              data: {
                userId: targetUserId,
                action: 'user_impersonation_started',
                actor: actorId,
                ipAddress,
                userAgent,
                metadata: { targetEmail: targetUser?.email ?? null },
              },
            })
            .catch((e: unknown) =>
              logger.error({
                err: e,
                msg: '[AuditLog] user_impersonation_started failed',
              }),
            );
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/stop-impersonating',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as any);
          const userId = session?.user?.id;
          if (!userId) return;

          const actorId = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;
          if (!actorId) return;

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttribute(AuthAttributes.ACTION, 'user_stop_impersonating');
            activeSpan.setAttribute(AuthAttributes.TARGET_USER_ID, userId);
            activeSpan.setAttribute(AuthAttributes.ACTOR_ID, actorId);
          }

          const ipAddress = resolveClientIp(ctx.headers);
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          await db.auditLog
            .create({
              data: {
                userId,
                action: 'user_stop_impersonating',
                actor: actorId,
                ipAddress,
                userAgent,
              },
            })
            .catch((e: unknown) =>
              logger.error({
                err: e,
                msg: '[AuditLog] user_stop_impersonating failed',
              }),
            );

          await storePendingStopImpersonation(userId);
        }),
      },
      {
        // Intercept self-user deletion (user deleting their own account).
        //
        // ⚠️  AUDIT LOG REMOVED FROM HERE intentionally.
        //
        // Previously, `account_deleted` was written in this before hook, which
        // fired even when Better Auth subsequently rejected the request due to
        // an incorrect password — producing a false audit entry for a deletion
        // that never happened.
        //
        // The audit log is now written in databaseHooks.user.delete.after,
        // which only fires after the DB row is actually removed, guaranteeing
        // the log entry reflects a real deletion.
        //
        // This hook now only:
        //   1. Guards against a missing password for credential accounts.
        //   2. Stashes IP, user-agent, email, and session context for the
        //      databaseHooks.user.delete.after audit log + cache invalidation.
        matcher: (ctx) => ctx.path === '/delete-user',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as any);
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

          // Stash request context now (headers available here) so the
          // databaseHooks after callback can attach them to the audit entry.
          // The entry is only consumed if deletion actually commits.
          const targetUser = await db.user
            .findUnique({ where: { id: userId } })
            .catch(() => null);

          await storePendingDeletion(userId, {
            ipAddress: resolveClientIp(ctx.headers) ?? null,
            userAgent: ctx.headers?.get('user-agent') ?? null,
            email: targetUser?.email ?? null,
            sessionToken: currentSession?.token ?? null,
            sessionId: currentSession?.id ?? null,
          });

          // invalidate cache is implemented in the databaseHooks.user.delete.after
        }),
      },
    ],
  },
});