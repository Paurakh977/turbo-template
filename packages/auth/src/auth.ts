import { db } from '@repo/database';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { admin } from 'better-auth/plugins/admin';
import { jwt } from 'better-auth/plugins';
import Redis from 'ioredis';
import { Resend } from 'resend';
import { ac, adminRole, superAdminRole, userRole } from './permissions';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';

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
async function storePendingUser(userId: string, data: UserData) {
  if (redis) {
    await redis
      .set(
        `pending_user_update:${userId}`,
        JSON.stringify(data),
        'PX',
        PENDING_TTL_MS,
      )
      .catch((e) => console.error('[Redis Error]', e));
  } else {
    pendingUserUpdates.set(userId, { data, ts: Date.now() });
  }
}
async function popPendingUser(userId: string): Promise<UserData | undefined> {
  if (redis) {
    const raw = await redis.get(`pending_user_update:${userId}`).catch((e) => {
      console.error('[Redis Error]', e);
      return null;
    });
    if (raw) {
      await redis
        .del(`pending_user_update:${userId}`)
        .catch((e) => console.error('[Redis Error]', e));
      try {
        return JSON.parse(raw) as UserData;
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  } else {
    const entry = pendingUserUpdates.get(userId);
    pendingUserUpdates.delete(userId);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > PENDING_TTL_MS) return undefined; // stale entry
    return entry.data;
  }
}

// ---------------------------------------------------------------------------
// Cache invalidation
// Destroys the user's secondary storage cache in Redis (if enabled) so that
// the next request misses the cache, hits the DB, and fetches the fresh data
// (like new roles, ban status, etc) instantly.
// ---------------------------------------------------------------------------
async function invalidateUserCache(userId: string) {
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
            | { userId?: string; role?: string }
            | undefined;
          const userId = body?.userId;
          const newRole = body?.role;

          if (!userId || !newRole) return;

          const oldUser = await db.user
            .findUnique({ where: { id: userId } })
            .catch(() => null);
          const oldRole = oldUser?.role ?? 'user';

          if (oldRole === newRole) return; // no-op, skip log

          const session = await getSessionFromCtx(ctx);
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
                metadata: { from: oldRole, to: newRole },
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

          const session = await getSessionFromCtx(ctx);
          const actorId = session?.user?.id;
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          // Skip logging if actor is banning themselves - this will fail anyway
          // and creates noise in audit logs
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

          // Force cache invalidation so ban reflects instantly
          await invalidateUserCache(userId);
        }),
      },
      {
        matcher: (ctx) => ctx.path === '/admin/unban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body as { userId?: string } | undefined;
          const userId = body?.userId;
          if (!userId) return;

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

          // Force cache invalidation so unban reflects instantly
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

          // Force cache wipe out for good measure, though Better Auth's
          // revoke mechanism will also attempt to clear the secondary cache
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

          const session = await getSessionFromCtx(ctx);
          const actorId = session?.user?.id;
          const ipAddress = ctx.headers?.get('x-forwarded-for') ?? undefined;
          const userAgent = ctx.headers?.get('user-agent') ?? undefined;

          // Skip logging if actor is deleting themselves
          if (actorId === targetUserId) {
            console.log(
              '[AuditLog] Skipping self-delete attempt:',
              targetUserId,
            );
            return;
          }

          // Fetch target user email for metadata before deletion
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

          // Force cache invalidation immediately prior to DB cascade deletion
          await invalidateUserCache(targetUserId);
        }),
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
const useSecureCookies = baseURL.startsWith('https://');

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
    console.error('[Email Error]', error);
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
  basePath: '/api/auth',
  secret,

  account: {
    encryptOAuthTokens: true,
  },

  // -------------------------------------------------------------------------
  // Secondary storage (Redis)
  // Removed the verbose per-key console.logs — they produce far too much
  // noise in production. Replace with a proper logger if you need observability.
  // -------------------------------------------------------------------------
  secondaryStorage: redis
    ? {
        get: async (key) => {
          const value = await redis.get(key);
          return value ?? null;
        },
        set: async (key, value, ttl) => {
          if (ttl) await redis.set(key, value, 'EX', ttl);
          else await redis.set(key, value);
        },
        delete: async (key) => {
          await redis.del(key);
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
        // Snapshot the current user before the update so the `after` hook can
        // see what actually changed. Guards against: no id in payload (admin
        // plugin partial updates), stale entries (TTL above).
        before: async (userData, _ctx) => {
          const userId = (userData as unknown as UserData).id;
          if (!userId) return { data: userData };

          const oldUser = await db.user
            .findUnique({ where: { id: userId } })
            .catch(() => null);
          if (oldUser) await storePendingUser(userId, oldUser as UserData);

          return { data: userData };
        },

        after: async (user) => {
          const u = user as unknown as UserData;
          if (!u?.id) return;

          const old = await popPendingUser(u.id);
          if (!old) return; // no snapshot means admin-plugin partial update — skip

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

      // Hard user delete - now handled by auditLogPlugin at HTTP layer
      // to capture actor and IP. This database hook is removed to avoid
      // duplicate entries (admin plugin bypasses this and goes through HTTP).
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
      sendEmail({
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
      });
    },
    revokeSessionsOnPasswordReset: true,
  },

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      sendEmail({
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
      });
    },
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
      '/forget-password': { window: 60, max: 3 },
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
          sendEmail({
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
          });
        },
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
      roles: {
        admin: adminRole,
        user: userRole,
        superAdmin: superAdminRole,
      },
      adminRoles: ['admin', 'superAdmin'],
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
          role: user.role,
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
  ],
});

export type Auth = typeof auth;
