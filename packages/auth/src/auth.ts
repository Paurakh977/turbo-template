import './load-env';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { admin } from 'better-auth/plugins/admin';
import { jwt } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { AUTH_BASE_PATH, ADMIN_PLUGIN_ROLES, ac } from './permissions';
import { parseRoles } from '@repo/roles';
import { validatePasswordPolicy } from './password-policy';
import { db } from '@repo/database';
import { redis } from './redis';
import { sendEmail } from './email-helpers';
import { databaseHooks } from './database-hooks';
import { auditLogPlugin } from './audit-plugin';
import {
  appName,
  appURL,
  baseURL,
  canSendEmail,
  hasGithub,
  hasGoogle,
  getEnv,
  parseIntEnv,
  secret,
  isProduction,
  usingPlaceholderSecret,
} from './env';
import { TRUSTED_PROXY_CIDRS } from './client-ip';

export const ADMIN_ROLES = ['admin', 'superAdmin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

// Fail-fast guard (H2): the build-time placeholder exists only so module
// evaluation during `next build` never throws. A SERVER boot in production
// without a real secret would sign every session/OTP/OAuth token with a key
// that is public in this repo. Crash loudly instead of running silently on it.
// The NEXT_PHASE exemption keeps builds green; every runtime path fails.
if (
  usingPlaceholderSecret &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  throw new Error(
    'BETTER_AUTH_SECRET is required in production. Refusing to sign sessions with the public build-time placeholder.',
  );
}

// Fail-fast guard (same philosophy as the secret check above): without a
// mail provider, requireEmailVerification below evaluates to false and
// production silently downgrades to unverified-email sign-ups. Crash loudly
// instead; operators who genuinely want email-less auth must opt out
// explicitly with EMAIL_VERIFICATION=relaxed.
if (
  isProduction &&
  !canSendEmail &&
  process.env.EMAIL_VERIFICATION !== 'relaxed' &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  throw new Error(
    'RESEND_API_KEY is required in production: without an email provider, email-verification enforcement silently turns off. Set RESEND_API_KEY, or EMAIL_VERIFICATION=relaxed to accept unverified sign-ups explicitly.',
  );
}

export const auth = betterAuth({
  appName,
  baseURL,
  basePath: AUTH_BASE_PATH,
  secret,

  // -------------------------------------------------------------------------
  // Hooks — server-side password complexity enforcement
  //
  // Better Auth only enforces minPasswordLength / maxPasswordLength. This
  // hook adds uppercase + lowercase + number + symbol requirements that
  // match the client-side validation in apps/web/src/lib/validation.ts.
  //
  // Applied to: sign-up (new accounts) and change-password (credential
  // accounts updating their password). Reset-password is intentionally
  // excluded — users clicking an email link should not be blocked by
  // complexity rules they haven't seen; enforcement happens on next sign-in.
  // -------------------------------------------------------------------------
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' || ctx.path === '/change-password') {
        const body = ctx.body as { password?: string; newPassword?: string };
        const password = body.newPassword ?? body.password;

        if (password && typeof password === 'string') {
          const result = validatePasswordPolicy(password);
          if (!result.valid) {
            throw new APIError('BAD_REQUEST', {
              message: result.message!,
            });
          }
        }
      }
    }),
  },

  account: {
    encryptOAuthTokens: true,
    // Account linking: when a user signs in via OAuth with an email that
    // already exists on a local (email/password) account, link the provider
    // account to that same user instead of failing with duplicate-email
    // errors or creating a separate identity. Only trusted providers may
    // link, and `requireLocalEmailVerified` (Better Auth default) requires
    // the local account email to be verified first — preventing account
    // takeover by claiming an unverified email via OAuth.
    accountLinking: {
      enabled: true,
      trustedProviders: [
        'email-password',
        ...(hasGoogle ? ['google'] : []),
        ...(hasGithub ? ['github'] : []),
      ],
    },
  },

  user: {
    deleteUser: {
      enabled: true,
    },
  },

  // -------------------------------------------------------------------------
  // Secondary storage (Redis)
  // All operations are wrapped with error handling — a Redis outage degrades
  // to primary storage instead of taking down auth-wide operations.
  // -------------------------------------------------------------------------
  secondaryStorage: redis
    ? ((r) => ({
        get: async (key) => {
          const value = await r.get(key).catch((error) => {
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
            await r.set(key, value, 'EX', ttlSeconds).catch((error) =>
              console.error('[Redis Error] secondaryStorage.set failed:', {
                key,
                ttl: ttlSeconds,
                error,
              }),
            );
            return;
          }

          await r.set(key, value).catch((error) =>
            console.error('[Redis Error] secondaryStorage.set failed:', {
              key,
              error,
            }),
          );
        },
        delete: async (key) => {
          await r.del(key).catch((error) =>
            console.error('[Redis Error] secondaryStorage.delete failed:', {
              key,
              error,
            }),
          );
        },
        // Atomic single-use read (Redis >= 6.2 GETDEL): verification tokens
        // / one-time codes are consumed without the read-then-delete race.
        // Better Auth gates state changes on a non-null return, so consume
        // MUST stay atomic across processes - the SecondaryStorage contract
        // forbids separate get+delete (two consumers could both receive the
        // value). The legacy path therefore uses ONE Lua GET+DEL script
        // (mirroring increment() below) so Redis < 6.2 stays supported
        // atomically; a total storage failure fails CLOSED (null), never
        // returning a value it failed to consume.
        getAndDelete: async (key: string) => {
          try {
            return await r.getdel(key);
          } catch (error) {
            console.error(
              '[Redis Error] secondaryStorage.getAndDelete (GETDEL) failed:',
              error,
            );
            try {
              return (await r.eval(
                `local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`,
                1,
                key,
              )) as string | null;
            } catch (fallbackError) {
              console.error(
                '[Redis Error] secondaryStorage.getAndDelete failed:',
                fallbackError,
              );
              return null;
            }
          }
        },
        // Atomic fixed-window counter backing Better Auth's rate limiter
        // (it wraps this into `consume`; without it the limiter degrades to
        // a racy get->decide->set and warns "best-effort" at boot).
        // TTL is applied on creation only - the counter expires a fixed
        // window after the first hit. `ttl` is in SECONDS.
        increment: async (key: string, ttl: number) => {
          try {
            return (await r.eval(
              `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`,
              1,
              key,
              String(Math.max(1, Math.floor(ttl))),
            )) as number;
          } catch (error) {
            console.error(
              '[Redis Error] secondaryStorage.increment failed:',
              error,
            );
            // Degrade open on limiter-storage failure (same availability
            // stance as the wrappers above): 0 <= max always allows.
            return 0;
          }
        },
      }))(redis)
    : undefined,

  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),

  databaseHooks,

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
    sendOnSignUp: true,
    sendOnSignIn: true,
    callbackURL: `${appURL}/auth/verify-email`,
  },

  // -------------------------------------------------------------------------
  // Social providers
  //
  // First-time OAuth users are silently signed up (auto-create account).
  // Subsequent logins link to the existing account via `accountLinking`.
  // -------------------------------------------------------------------------
  socialProviders: {
    ...(hasGoogle
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID as string,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            prompt: 'select_account',
          },
        }
      : {}),
    ...(hasGithub
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID as string,
            clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
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
    expiresIn: parseIntEnv('SESSION_EXPIRES_IN', 60 * 60 * 24 * 7), // 7 days

    updateAge: parseIntEnv('SESSION_UPDATE_AGE', 60 * 60 * 24), // 1 day

    freshAge: parseIntEnv('SESSION_FRESH_AGE', 60 * 15), // 15 minutes for destructive actions like delete-user
  },

  // -------------------------------------------------------------------------
  // Rate limiting
  //
  // Three-layer architecture:
  //   1. Nginx — IP-wide flood protection (broad, connection-level)
  //   2. Better Auth plugin — per-endpoint, per-user/IP limits (this config)
  //   3. Server Action rate limiter — custom DB-backed for app-level mutations
  //
    // Endpoint classification:
    //   - Passive/read: high limits so passive session polling never triggers
    //     false UX noise (get-session → 300/min, list-accounts → 60/min, etc.)
  //   - Auth challenge: strict limits to prevent brute-force. Per-page inline
  //     errors handle 429 (sign-in 5/min, sign-up 3/min, 2FA verify 3/10s)
  //   - Destructive: tightest limits (delete-user 2/min, change-email 3/min)
  //
  // NOTE: customRules paths are relative to the Better Auth basePath (the
  // `ctx.path` matched is the path *after* stripping the basePath prefix).
  // Do NOT include leading "/api/auth".
  // -------------------------------------------------------------------------
  rateLimit: {
    enabled: true,
    window: parseIntEnv('RATE_LIMIT_WINDOW', 60),
    max: parseIntEnv('RATE_LIMIT_MAX', 20),
    storage: redis ? 'secondary-storage' : 'database',
    customRules: {
      // Passive / read endpoints (relaxed - prevent UX noise).
      // get-session is the HOTTEST path in the app: every server-rendered
      // dashboard page resolves it (Architecture B web -> API), and the
      // browser client refetches on window focus. 60/min exhausted in
      // seconds with two tabs open; 300/min still bounds abuse (5/s avg)
      // while never bothering real users - the read itself is Redis-cached.
      '/get-session': { window: 60, max: 300 },
      '/list-accounts': { window: 60, max: 60 },
      '/admin/list-users': { window: 60, max: 60 },
      '/admin/list-user-sessions': { window: 60, max: 30 },
      '/admin/has-permission': { window: 60, max: 30 },

      // ── Admin mutation endpoints (strict) ───────────────────────────────
      '/admin/set-role': { window: 60, max: 5 },
      '/admin/ban-user': { window: 60, max: 3 },
      '/admin/unban-user': { window: 60, max: 3 },
      '/admin/impersonate-user': { window: 60, max: 3 },
      '/admin/stop-impersonating': { window: 60, max: 6 },
      '/admin/remove-user': { window: 60, max: 2 },
      '/admin/revoke-user-sessions': { window: 60, max: 5 },
      '/admin/revoke-user-session': { window: 60, max: 5 },
      '/admin/create-user': { window: 60, max: 3 },
      '/admin/set-user-password': { window: 60, max: 3 },

      // ── Auth challenge endpoints (strict — per-page inline errors) ─────
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

      // ── Destructive actions (tightest limits) ──────────────────────────
      '/delete-user': { window: 60, max: 2 },
    },
  },

  // -------------------------------------------------------------------------
  // Trusted origins
  // -------------------------------------------------------------------------
  trustedOrigins: Array.from(
    new Set([
      // CSRF-relevant origins (H1): localhost must never be trusted in
      // production — mirrors the NODE_ENV gating of localhost conveniences in
      // apps/api/src/main.ts CORS. Local HTTPS prod-profile stacks reach the
      // app via TRUSTED_ORIGINS (.env.example sets TRUSTED_ORIGINS=https://localhost).
      ...(isProduction
        ? []
        : ['http://localhost:3000', 'https://localhost']),
      appURL,
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
      // Every hop in front of the API is infrastructure we control (nginx
      // proxy, web-tier gateway, docker networks). Trusting these ranges lets
      // Better Auth resolve the real client IP from X-Forwarded-For instead
      // of warning "could not determine a client IP" and collapsing all
      // rate-limit buckets into one shared per-path bucket.
      // Single source of truth: client-ip.ts walks this same list when audit
      // hooks resolve IPs — keep them identical by construction.
      trustedProxies: [...TRUSTED_PROXY_CIDRS],
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
        period: parseIntEnv('TWO_FACTOR_TOTP_PERIOD', 30),
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
        // NOTE: better-auth OTP periods are MINUTES (it multiplies by 60);
        // every other duration knob in this file is SECONDS.
        period: parseIntEnv('TWO_FACTOR_OTP_PERIOD', 3), // MINUTES (better-auth multiplies by 60)
        allowedAttempts: parseIntEnv('TWO_FACTOR_OTP_ATTEMPTS', 5),
      },
      backupCodeOptions: {
        amount: parseIntEnv('TWO_FACTOR_BACKUP_AMOUNT', 10),
        length: parseIntEnv('TWO_FACTOR_BACKUP_LENGTH', 10),
        storeBackupCodes: 'encrypted',
      },
      twoFactorCookieMaxAge: parseIntEnv('TWO_FACTOR_COOKIE_MAX_AGE', 600),
      trustDeviceMaxAge: parseIntEnv('TRUST_DEVICE_MAX_AGE', 60 * 60 * 24 * 30),
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
          // Include the stable user id so JWT consumers (microservices, the
          // API gateway) can resolve the user without a session lookup.
          id: user.id,
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