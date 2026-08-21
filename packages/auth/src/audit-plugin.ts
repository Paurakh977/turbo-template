import { db } from '@repo/database';
import { createAuthMiddleware, getSessionFromCtx, APIError } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';
import { parseRoles, serializeRoles, getMaxRoleWeight } from '@repo/roles';
import {
  enforceRoleHierarchy,
} from './hierarchy';
import {
  invalidateUserCache,
  storePendingDeletion,
  storePendingStopImpersonation,
} from './pending-storage';

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

          // 🔒 HIERARCHY GUARD — actor cannot change the role of a peer/superior.
          await enforceRoleHierarchy(ctx, userId);

          // 🔒 Also prevent assigning a role HIGHER than the actor's own role.
          const session = await getSessionFromCtx(ctx);
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

          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
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
              console.error('[AuditLog] role_changed failed:', e),
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

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          const session = await getSessionFromCtx(ctx);
          const actorId = session?.user?.id;
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          if (actorId === userId) {
            console.log('[AuditLog] Skipping self-ban attempt:', userId);
            return;
          }

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
              console.error('[AuditLog] user_banned failed:', e),
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

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          const session = await getSessionFromCtx(ctx);
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
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
              console.error('[AuditLog] user_unbanned failed:', e),
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

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, userId);

          const session = await getSessionFromCtx(ctx);
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
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
              console.error('[AuditLog] sessions_revoked failed:', e),
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

          // 🔒 HIERARCHY GUARD
          await enforceRoleHierarchy(ctx, targetUserId);

          const session = await getSessionFromCtx(ctx);
          const actorId = session?.user?.id;
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          if (actorId === targetUserId) {
            console.log(
              '[AuditLog] Skipping self-delete attempt:',
              targetUserId,
            );
            return;
          }

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
              console.error('[AuditLog] user_deleted failed:', e),
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

          // Get session and check if already being impersonated
          const session = await getSessionFromCtx(ctx);
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
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
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
              console.error('[AuditLog] user_impersonation_started failed:', e),
            );
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/stop-impersonating',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          const userId = session?.user?.id;
          if (!userId) return;

          const actorId = (
            session as unknown as {
              session?: { impersonatedBy?: string | null };
            }
          )?.session?.impersonatedBy;
          if (!actorId) return;

          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
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
              console.error('[AuditLog] user_stop_impersonating failed:', e),
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
          const session = await getSessionFromCtx(ctx);
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
            ipAddress: ctx.headers?.get('x-forwarded-for') ?? null,
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