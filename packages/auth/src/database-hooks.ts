import { db } from '@repo/database';
import { createAuthMiddleware } from 'better-auth/api';
import { parseRoles, serializeRoles } from '@repo/roles';
import {
  invalidateUserCache,
  popPendingDeletion,
  popPendingStopImpersonation,
  popPendingUser,
  storePendingUser,
  type SessionData,
  type UserData,
} from './pending-storage';

type HeaderSource = {
  headers?: { get: (key: string) => string | null };
  request?: { headers: { get: (key: string) => string | null } };
};

function extractIpAndUserAgent(context: HeaderSource | undefined): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  const ipAddress =
    context?.headers?.get('x-forwarded-for') ??
    context?.request?.headers?.get('x-forwarded-for') ??
    undefined;
  const userAgent =
    context?.headers?.get('user-agent') ??
    context?.request?.headers?.get('user-agent') ??
    undefined;
  return { ipAddress, userAgent };
}

/**
 * Database hooks for normal (non-admin-plugin) database operations.
 * Admin plugin operations (setRole, banUser, unbanUser) bypass these hooks
 * and are captured by `auditLogPlugin` instead.
 */
export const databaseHooks = {
  user: {
    create: {
      before: async (userData: unknown) => {
        const data = userData as Record<string, unknown>;
        if (data.role !== undefined) {
          data.role = serializeRoles(parseRoles(data.role));
        }
        return {
          data: data as unknown as Parameters<typeof createAuthMiddleware>[0],
        };
      },
      after: async (user: unknown, ctx: unknown) => {
        const u = user as unknown as UserData;
        if (!u?.id) return;

        const { ipAddress, userAgent } = extractIpAndUserAgent(
          ctx as HeaderSource | undefined,
        );

        db.auditLog
          .create({
            data: {
              userId: u.id,
              action: 'user_signed_up',
              ipAddress,
              userAgent,
              metadata: { email: u.email, name: u.name },
            },
          })
          .catch((e: unknown) =>
            console.error('[AuditLog] user_signed_up failed:', e),
          );
      },
    },

    update: {
      // Canonicalize role to Better Auth's comma-separated storage format.
      before: async (userData: unknown) => {
        const data = userData as Record<string, unknown>;
        if (data.role !== undefined) {
          data.role = serializeRoles(parseRoles(data.role));
        }

        const userId = (userData as unknown as UserData).id;
        if (!userId) return { data };

        const oldUser = await db.user
          .findUnique({ where: { id: userId } })
          .catch(() => null);
        if (oldUser) await storePendingUser(userId, oldUser as UserData);

        return { data };
      },

      after: async (user: unknown) => {
        const u = user as unknown as UserData;
        if (!u?.id) return;

        const old = await popPendingUser(u.id);
        if (!old) {
          await invalidateUserCache(u.id);
          return;
        }

        const writes: Promise<unknown>[] = [];

        // Role change via normal user update (rare; admin path is separate)
        if (old.role !== u.role) {
          writes.push(
            db.auditLog.create({
              data: {
                userId: u.id,
                action: 'role_changed',
                metadata: { from: old.role ?? 'user', to: u.role ?? 'user' },
              },
            }),
          );
        }

        // Ban/unban via normal update path
        if (!old.banned && u.banned) {
          writes.push(
            db.auditLog.create({
              data: {
                userId: u.id,
                action: 'user_banned',
                metadata: { reason: u.banReason ?? null },
              },
            }),
          );
        }
        if (old.banned && !u.banned) {
          writes.push(
            db.auditLog.create({
              data: { userId: u.id, action: 'user_unbanned' },
            }),
          );
        }

        // Email change
        if (old.email !== u.email) {
          writes.push(
            db.auditLog.create({
              data: {
                userId: u.id,
                action: 'email_changed',
                metadata: { oldEmail: old.email },
              },
            }),
          );
        }

        if (writes.length === 0) return;

        await Promise.allSettled(writes).then((results) => {
          for (const r of results) {
            if (r.status === 'rejected') {
              console.error('[AuditLog] user update hook failed:', r.reason);
            }
          }
        });

        // Always invalidate cache on user update so changes
        // are reflected immediately without waiting for session expiry.
        await invalidateUserCache(u.id);
      },
    },

    delete: {
      after: async (user: unknown) => {
        const u = user as unknown as UserData;
        if (!u?.id) return;

        const meta = await popPendingDeletion(u.id);

        if (meta) {
          await db.auditLog
            .create({
              data: {
                userId: u.id,
                action: 'account_deleted',
                actor: null,
                ipAddress: meta.ipAddress ?? null,
                userAgent: meta.userAgent ?? null,
                metadata: { email: meta.email ?? u.email ?? null },
              },
            })
            .catch((e: unknown) =>
              console.error('[AuditLog] account_deleted failed:', e),
            );
        }

        // Pass session token/id from the stash — by this point the sessions are
        // already deleted from the DB, so findMany returns []. Without these options
        // the session-specific Redis keys would survive until natural TTL expiry,
        // leaving a window where the deleted user's token could still authenticate.
        await invalidateUserCache(u.id, {
          sessionToken: meta?.sessionToken ?? null,
          sessionId: meta?.sessionId ?? null,
        });
      },
    },

    // Self-deletion: audit log + cache invalidation handled in delete.after above.
    // Admin-initiated deletion: audit log is in auditLogPlugin's /admin/remove-user
    // hook to capture the actor's identity and IP address.
  },

  session: {
    create: {
      // Fires on sign-in AND impersonation
      after: async (session: unknown, ctx: unknown) => {
        const s = session as unknown as SessionData;
        if (!s?.userId) return;
        const { ipAddress, userAgent } = extractIpAndUserAgent(
          ctx as HeaderSource | undefined,
        );

        db.auditLog
          .create({
            data: {
              userId: s.userId,
              action: s.impersonatedBy
                ? 'user_impersonated'
                : 'session_created',
              actor: s.impersonatedBy ?? undefined,
              ipAddress,
              userAgent,
            },
          })
          .catch((e: unknown) =>
            console.error('[AuditLog] session_created failed:', e),
          );
      },
    },

    // Fires on sign-out AND admin session revoke
    delete: {
      before: async (session: unknown, ctx: unknown) => {
        const s = session as unknown as SessionData;
        if (!s?.userId) return;

        if (
          s.impersonatedBy &&
          (await popPendingStopImpersonation(s.userId))
        ) {
          return;
        }

        const context = ctx as
          | {
              headers?: {
                get: (key: string) => string | null;
              };
            }
          | undefined;

        const ipAddress =
          s.ipAddress ??
          context?.headers?.get('x-forwarded-for') ??
          context?.headers?.get('x-real-ip') ??
          undefined;
        const userAgent =
          s.userAgent ?? context?.headers?.get('user-agent') ?? undefined;

        await db.auditLog
          .create({
            data: {
              userId: s.userId,
              action: s.impersonatedBy
                ? 'user_stop_impersonating'
                : 'user_signed_out',
              actor: s.impersonatedBy ?? undefined,
              ipAddress,
              userAgent,
            },
          })
          .catch((e: unknown) =>
            console.error('[AuditLog] session delete failed:', e),
          );
      },
    },
  },
};