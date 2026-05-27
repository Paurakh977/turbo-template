import { db } from '@repo/database';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { admin } from 'better-auth/plugins/admin';
import { jwt } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import Redis from 'ioredis';
import { Resend } from 'resend';
import { AUTH_BASE_PATH, ADMIN_PLUGIN_ROLES, ac } from './permissions';
import {
  createAuthMiddleware,
  getSessionFromCtx,
  APIError,
} from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';

export const ADMIN_ROLES = ['admin', 'superAdmin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

import { parseRoles, serializeRoles, getMaxRoleWeight } from './roles';

// Deletion request context
// Stashed in the before hook (where headers are available) and consumed in
// databaseHooks.user.delete.after (where headers are not).
interface PendingDeletionMeta {
  ipAddress: string | null;
  userAgent: string | null;
  email: string | null;
  sessionToken: string | null;
  sessionId: string | null;
}

async function storePendingDeletion(userId: string, meta: PendingDeletionMeta) {
  if (redis) {
    await redis
      .set(
        `pending_deletion:${userId}`,
        JSON.stringify(meta),
        'PX',
        PENDING_TTL_MS,
      )
      .catch((e) => {
        console.error('[Redis Error] storePendingDeletion:', e);
        storePendingInMemory(`deletion:${userId}`, meta);
      });
  } else {
    storePendingInMemory(`deletion:${userId}`, meta);
  }
}

async function popPendingDeletion(
  userId: string,
): Promise<PendingDeletionMeta | undefined> {
  if (redis) {
    let parsed: PendingDeletionMeta | undefined;
    const raw = await redis.get(`pending_deletion:${userId}`).catch((e) => {
      console.error('[Redis Error] popPendingDeletion:', e);
      return null;
    });
    if (raw) {
      await redis
        .del(`pending_deletion:${userId}`)
        .catch((e) => console.error('[Redis Error]', e));
      try {
        parsed = JSON.parse(raw) as PendingDeletionMeta;
      } catch {
        console.error('[Redis Error] popPendingDeletion: invalid payload', {
          userId,
        });
      }
    }

    return (
      parsed ?? popPendingFromMemory<PendingDeletionMeta>(`deletion:${userId}`)
    );
  } else {
    return popPendingFromMemory<PendingDeletionMeta>(`deletion:${userId}`);
  }
}

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
async function enforceRoleHierarchy(
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
  const targetRole = (targetUser?.role as string | null) ?? 'user';

  if (getMaxRoleWeight(targetRole) >= getMaxRoleWeight(actorRole)) {
    throw new APIError('FORBIDDEN', {
      message:
        'You do not have permission to perform this action on a user with equal or higher privileges.',
    });
  }
}

// Better Auth types `data` / `oldData` in databaseHooks as `{}` — these
// interfaces let us safely cast to the actual shape without losing type safety
// everywhere else in the file.
interface UserData {
  id: string;
  email: string;
  name?: string;
  role?: string;
  banned?: boolean;
  banReason?: string | null;
}

interface SessionData {
  userId: string;
  impersonatedBy?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Stores the old user state before an update so the `after` hook can diff it.
 *
 * IMPORTANT: This map is intentionally in-process only.
 * Admin plugin operations (setRole / banUser / unbanUser) bypass databaseHooks
 * entirely — those are intercepted at the HTTP layer by `auditLogPlugin`.
 * The only updates that reach databaseHooks are normal user-initiated ones
 * (email change, profile edit) which complete in the same request, so this
 * is safe in practice.
 *
 * Guard: we prune entries older than 30 s to avoid leaks if an `after` hook
 * somehow never fires (e.g., adapter error).
 */
const pendingUserUpdates = new Map<string, { data: UserData; ts: number }>();

const PENDING_TTL_MS = 30_000;

function storePendingInMemory(key: string, data: unknown) {
  pendingUserUpdates.set(key, {
    data: data as UserData,
    ts: Date.now(),
  });
}

function popPendingFromMemory<T>(key: string): T | undefined {
  const entry = pendingUserUpdates.get(key);
  pendingUserUpdates.delete(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined;
  return entry.data as unknown as T;
}

async function storePendingUser(userId: string, data: UserData) {
  if (redis) {
    await redis
      .set(
        `pending_user_update:${userId}`,
        JSON.stringify(data),
        'PX',
        PENDING_TTL_MS,
      )
      .catch((e) => {
        console.error('[Redis Error] storePendingUser:', e);
        storePendingInMemory(userId, data);
      });
  } else {
    storePendingInMemory(userId, data);
  }
}
async function popPendingUser(userId: string): Promise<UserData | undefined> {
  if (redis) {
    let parsed: UserData | undefined;
    const raw = await redis.get(`pending_user_update:${userId}`).catch((e) => {
      console.error('[Redis Error]', e);
      return null;
    });
    if (raw) {
      await redis
        .del(`pending_user_update:${userId}`)
        .catch((e) => console.error('[Redis Error]', e));
      try {
        parsed = JSON.parse(raw) as UserData;
      } catch (e) {
        console.error('[Redis Error] popPendingUser: invalid payload', {
          userId,
          error: e,
        });
      }
    }

    return parsed ?? popPendingFromMemory<UserData>(userId);
  } else {
    return popPendingFromMemory<UserData>(userId);
  }
}

// ---------------------------------------------------------------------------
// Cache invalidation
// Destroys the user's secondary storage cache in Redis (if enabled) so that
// the next request misses the cache, hits the DB, and fetches the fresh data
// (like new roles, ban status, etc) instantly.
// ---------------------------------------------------------------------------
async function invalidateUserCache(
  userId: string,
  options?: { sessionToken?: string | null; sessionId?: string | null },
) {
  if (!redis) return;
  try {
    const userSessions = await db.session.findMany({ where: { userId } });
    const pipeline = redis.pipeline();
    for (const session of userSessions) {
      // Better Auth usually caches the session using its token as the key
      pipeline.del(session.token);
      // Just in case it uses variations in newer versions
      pipeline.del(`session:${session.token}`);
      pipeline.del(`session:${session.id}`);
    }
    // Also delete any cached user record directly
    pipeline.del(userId);
    pipeline.del(`user:${userId}`);

    if (options?.sessionToken) {
      pipeline.del(options.sessionToken);
      pipeline.del(`session:${options.sessionToken}`);
    }
    if (options?.sessionId) {
      pipeline.del(`session:${options.sessionId}`);
    }

    await pipeline.exec();
    console.log(`[Cache] Invalidated secondary storage for user ${userId}`);
  } catch (e) {
    console.error('[Cache Error] Failed to invalidate user cache:', e);
  }
}

// Sweep stale entries every 5 minutes so the map can't grow unbounded.
setInterval(() => {
  if (redis) return; // Redis handles TTL natively
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, entry] of pendingUserUpdates) {
    if (entry.ts < cutoff) pendingUserUpdates.delete(id);
  }
}, 5 * 60_000).unref();

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
const auditLogPlugin = (): BetterAuthPlugin => ({
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
function getEnv(name: string, { required = true } = {}): string | undefined {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (required)
    throw new Error(`Missing required environment variable: ${name}`);
  return undefined;
}

const isProduction = process.env.NODE_ENV === 'production';
const appName = getEnv('APP_NAME', { required: false }) ?? 'Ozon';
const baseURL = getEnv('BETTER_AUTH_URL') as string;
const appURL = getEnv('NEXT_PUBLIC_APP_URL', { required: false }) ?? baseURL;
const secret = getEnv('BETTER_AUTH_SECRET') as string;
const resendApiKey = getEnv('RESEND_API_KEY', { required: false });
const devEmailOverride = getEnv('DEV_EMAIL_OVERRIDE', { required: false });
const emailFrom =
  getEnv('EMAIL_FROM', { required: false }) ??
  `${appName} <onboarding@resend.dev>`;
const redisUrl = getEnv('REDIS_URL', { required: false });

const googleClientId = getEnv('GOOGLE_CLIENT_ID', { required: false });
const googleClientSecret = getEnv('GOOGLE_CLIENT_SECRET', { required: false });
const githubClientId = getEnv('GITHUB_CLIENT_ID', { required: false });
const githubClientSecret = getEnv('GITHUB_CLIENT_SECRET', { required: false });

const hasGoogle = Boolean(googleClientId && googleClientSecret);
const hasGithub = Boolean(githubClientId && githubClientSecret);
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const canSendEmail = Boolean(resend);
const redis = redisUrl ? new Redis(redisUrl) : null;

// ---------------------------------------------------------------------------
// Email helper
// ---------------------------------------------------------------------------
async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.log(`[AUTH EMAIL][NO_PROVIDER] to=${to} subject=${subject}`);
    return;
  }
  const recipient = devEmailOverride ?? to;
  const effectiveSubject = devEmailOverride
    ? `[DEV → ${to}] ${subject}`
    : subject;
  const fromAddress = devEmailOverride
    ? `Ozon <onboarding@resend.dev>`
    : emailFrom;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: recipient,
    subject: effectiveSubject,
    html,
  });

  if (error) {
    console.error('[Email Error]', {
      name: error.name,
      statusCode: error.statusCode,
      message: error.message,
      subject,
      recipient: recipient.includes('@') ? recipient.split('@')[1] : 'unknown',
    });
    throw error;
  } else if (devEmailOverride) {
    console.log(
      `[Email] Redirected from ${to} → ${recipient} | Subject: ${subject}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Auth instance
// ---------------------------------------------------------------------------
export const auth = betterAuth({
  appName,
  baseURL,
  basePath: AUTH_BASE_PATH,
  secret,

  account: {
    encryptOAuthTokens: true,
  },

  user: {
    deleteUser: {
      enabled: true,
    },
  },

  // -------------------------------------------------------------------------
  // Secondary storage (Redis)
  // Removed the verbose per-key console.logs — they produce far too much
  // noise in production. Replace with a proper logger if you need observability.
  // -------------------------------------------------------------------------
  secondaryStorage: redis
    ? {
        get: async (key) => {
          const value = await redis.get(key).catch((error) => {
            console.error('[Redis Error] secondaryStorage.get failed:', error);
            return null;
          });
          return value ?? null;
        },
        set: async (key, value, ttl) => {
          const ttlSeconds =
            typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0
              ? Math.max(1, Math.floor(ttl))
              : undefined;

          if (ttlSeconds) {
            await redis.set(key, value, 'EX', ttlSeconds).catch((error) =>
              console.error('[Redis Error] secondaryStorage.set failed:', {
                key,
                ttl: ttlSeconds,
                error,
              }),
            );
            return;
          }

          await redis.set(key, value).catch((error) =>
            console.error('[Redis Error] secondaryStorage.set failed:', {
              key,
              error,
            }),
          );
        },
        delete: async (key) => {
          await redis.del(key).catch((error) =>
            console.error('[Redis Error] secondaryStorage.delete failed:', {
              key,
              error,
            }),
          );
        },
      }
    : undefined,

  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),

  // -------------------------------------------------------------------------
  // Database hooks
  //
  // These fire for NORMAL (non-admin-plugin) database operations.
  // Admin plugin operations (setRole, banUser, unbanUser) bypass these hooks
  // and are captured by the auditLogPlugin above.
  // -------------------------------------------------------------------------
  databaseHooks: {
    user: {
      create: {
        before: async (userData, _ctx) => {
          const data = userData as Record<string, unknown>;
          if (data.role !== undefined) {
            data.role = serializeRoles(parseRoles(data.role));
          }
          return {
            data: data as unknown as Parameters<typeof createAuthMiddleware>[0],
          };
        },
        after: async (user, ctx) => {
          const u = user as unknown as UserData;
          if (!u?.id) return;

          const context = ctx as
            | {
                headers?: {
                  get: (key: string) => string | null;
                };
                request?: {
                  headers: { get: (key: string) => string | null };
                };
              }
            | undefined;

          const ipAddress =
            context?.headers?.get('x-forwarded-for') ??
            context?.request?.headers?.get('x-forwarded-for') ??
            undefined;
          const userAgent =
            context?.headers?.get('user-agent') ??
            context?.request?.headers?.get('user-agent') ??
            undefined;

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
        before: async (userData, _ctx) => {
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

        after: async (user) => {
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
        after: async (user) => {
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
        after: async (session, ctx) => {
          const s = session as unknown as SessionData;
          if (!s?.userId) return;
          const context = ctx as
            | {
                headers?: {
                  get: (key: string) => string | null;
                };
                request?: {
                  headers: { get: (key: string) => string | null };
                };
              }
            | undefined;

          const ipAddress =
            context?.headers?.get('x-forwarded-for') ??
            context?.request?.headers?.get('x-forwarded-for') ??
            undefined;
          const userAgent =
            context?.headers?.get('user-agent') ??
            context?.request?.headers?.get('user-agent') ??
            undefined;

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
        before: async (session, ctx) => {
          const s = session as unknown as SessionData;
          if (!s?.userId) return;

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
  },

  // -------------------------------------------------------------------------
  // Email & password
  // -------------------------------------------------------------------------
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: canSendEmail,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
    sendResetPassword: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: 'Reset your password — Ozon',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Reset your password</h2>
            <p style="color:#64748b">Click the button below to set a new password for your account.</p>
            <a href="${url}"
               style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;
                      border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
              Reset Password
            </a>
            <p style="color:#94a3b8;font-size:12px">
              This link expires in 1 hour. If you didn't request this, ignore this email.
            </p>
          </div>
        `,
      }).catch((error: unknown) => {
        console.error('[Email Delivery Error] reset_password', error);
      });
    },
    revokeSessionsOnPasswordReset: true,
  },

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      void sendEmail({
        to: user.email,
        subject: 'Verify your email — Ozon',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Verify your email</h2>
            <p style="color:#64748b">Click below to verify your email and activate your account.</p>
            <a href="${url}"
              style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;
                      border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
              Verify Email
            </a>
            <p style="color:#94a3b8;font-size:12px">
              This link expires in 24 hours. If you didn't sign up, ignore this email.
            </p>
          </div>
        `,
      }).catch((error: unknown) => {
        console.error('[Email Delivery Error] verification_email', error);
      });
    },
    sendOnSignIn: true,
    callbackURL: `${appURL}/auth/verify-email`,
  },

  // -------------------------------------------------------------------------
  // Social providers
  // -------------------------------------------------------------------------
  socialProviders: {
    ...(hasGoogle
      ? {
          google: {
            clientId: googleClientId as string,
            clientSecret: googleClientSecret as string,
            prompt: 'select_account',
          },
        }
      : {}),
    ...(hasGithub
      ? {
          github: {
            clientId: githubClientId as string,
            clientSecret: githubClientSecret as string,
          },
        }
      : {}),
  },

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------
  session: {
    /**
     * Store sessions in the primary DB even though Redis is configured as
     * secondary storage. This ensures databaseHooks.session.delete fires
     * correctly on revocation, and gives you a persistent session audit trail.
     */
    storeSessionInDatabase: true,
    expiresIn: process.env.SESSION_EXPIRES_IN
      ? parseInt(process.env.SESSION_EXPIRES_IN)
      : 60 * 60 * 24 * 7, // 7 days

    updateAge: process.env.SESSION_UPDATE_AGE
      ? parseInt(process.env.SESSION_UPDATE_AGE)
      : 60 * 60 * 24, // 1 day

    freshAge: process.env.SESSION_FRESH_AGE
      ? parseInt(process.env.SESSION_FRESH_AGE)
      : 60 * 15, // 15 minutes for destructive actions like delete-user
  },

  // -------------------------------------------------------------------------
  // Rate limiting
  //
  // FIX: customRules paths must be relative to the Better Auth basePath,
  // NOT include the full "/api/auth" prefix. The `ctx.path` that Better Auth
  // matches against is the path *after* stripping the basePath.
  //
  // Before (wrong): '/api/auth/sign-in/email'
  // After  (correct): '/sign-in/email'
  // -------------------------------------------------------------------------
  rateLimit: {
    enabled: true,
    window: process.env.RATE_LIMIT_WINDOW
      ? parseInt(process.env.RATE_LIMIT_WINDOW)
      : 60,
    max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 20,
    storage: redis ? 'secondary-storage' : 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 3 },
      '/two-factor/send-otp': { window: 60, max: 3 },
      '/two-factor/verify-totp': { window: 10, max: 3 },
      '/two-factor/verify-otp': { window: 10, max: 3 },
      '/two-factor/verify-backup-code': { window: 10, max: 3 },
      '/change-password': { window: 60, max: 5 },
      '/change-email': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
      '/delete-user': { window: 60, max: 2 },
    },
  },

  // -------------------------------------------------------------------------
  // Trusted origins
  // -------------------------------------------------------------------------
  trustedOrigins: Array.from(
    new Set([
      'http://localhost:3000',
      appURL,
      'https://localhost',
      ...(getEnv('TRUSTED_ORIGINS', { required: false })
        ?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? []),
    ]),
  ),

  // -------------------------------------------------------------------------
  // Advanced
  // -------------------------------------------------------------------------
  advanced: {
    // Deployment runs behind TLS-terminating nginx/certs in all environments.
    useSecureCookies: true,
    ipAddress: {
      disableIpTracking: false,
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    backgroundTasks: {
      /**
       * FIX: The handler must be truly fire-and-forget — do NOT await `promise`
       * here. Awaiting blocks the HTTP response until the background task
       * completes, which defeats the whole purpose of `runInBackground`.
       *
       * Use `void` + `.catch()` for non-blocking error capture.
       */
      handler: (promise) => {
        void promise.catch((e: unknown) =>
          console.error('[Better Auth] Background task failed:', e),
        );
      },
    },
  },

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------
  plugins: [
    twoFactor({
      issuer: 'Ozon',
      totpOptions: {
        digits: 6,
        period: process.env.TWO_FACTOR_TOTP_PERIOD
          ? parseInt(process.env.TWO_FACTOR_TOTP_PERIOD)
          : 30,
      },
      otpOptions: {
        sendOTP: async ({ user, otp }) => {
          void sendEmail({
            to: user.email,
            subject: 'Your verification code — Ozon',
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
                <h2 style="color:#1e293b">Your verification code</h2>
                <p style="color:#64748b">Use this code to complete sign-in. It expires in 3 minutes.</p>
                <div style="font-size:36px;font-weight:700;letter-spacing:8px;
                            color:#6366f1;padding:16px 0">
                  ${otp}
                </div>
                <p style="color:#94a3b8;font-size:12px">
                  If you didn't request this code, ignore this email.
                </p>
              </div>
            `,
          }).catch((error: unknown) => {
            console.error('[Email Delivery Error] two_factor_otp', error);
          });
        },
        storeOTP: 'encrypted',
        period: process.env.TWO_FACTOR_OTP_PERIOD
          ? parseInt(process.env.TWO_FACTOR_OTP_PERIOD)
          : 3,
        allowedAttempts: process.env.TWO_FACTOR_OTP_ATTEMPTS
          ? parseInt(process.env.TWO_FACTOR_OTP_ATTEMPTS)
          : 5,
      },
      backupCodeOptions: {
        amount: process.env.TWO_FACTOR_BACKUP_AMOUNT
          ? parseInt(process.env.TWO_FACTOR_BACKUP_AMOUNT)
          : 10,
        length: process.env.TWO_FACTOR_BACKUP_LENGTH
          ? parseInt(process.env.TWO_FACTOR_BACKUP_LENGTH)
          : 10,
        storeBackupCodes: 'encrypted',
      },
      twoFactorCookieMaxAge: process.env.TWO_FACTOR_COOKIE_MAX_AGE
        ? parseInt(process.env.TWO_FACTOR_COOKIE_MAX_AGE)
        : 600,
      trustDeviceMaxAge: process.env.TRUST_DEVICE_MAX_AGE
        ? parseInt(process.env.TRUST_DEVICE_MAX_AGE)
        : 60 * 60 * 24 * 30,
    }),

    admin({
      ac,
      roles: ADMIN_PLUGIN_ROLES,
      adminRoles: ['admin', 'superAdmin'], // only admin + superAdmin get the admin panel
      defaultRole: 'user',
      defaultBanReason: 'Violated terms of service',
      bannedUserMessage:
        'Your account has been suspended. Contact support if you believe this is an error.',
    }),

    jwt({
      jwt: {
        expirationTime: '30m',
        definePayload: ({ user }) => ({
          email: user.email,
          role: parseRoles(user.role as string | string[] | null | undefined),
        }),
        issuer: baseURL,
        audience: baseURL,
      },
      jwks: {
        keyPairConfig: { alg: 'ES256' },
        rotationInterval: 60 * 60 * 24 * 30,
        gracePeriod: 60 * 60 * 24 * 7,
      },
    }),

    auditLogPlugin(),

    // Must be last for Next.js Server Actions so Set-Cookie headers from
    // auth.api.* calls (e.g. deleteUser/signOut) are applied to the response.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
