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
  secret,
  getEnv,
} from './env';

export const ADMIN_ROLES = ['admin', 'superAdmin'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

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
  // Three-layer architecture:
  //   1. Nginx — IP-wide flood protection (broad, connection-level)
  //   2. Better Auth plugin — per-endpoint, per-user/IP limits (this config)
  //   3. Server Action rate limiter — custom DB-backed for app-level mutations
  //
  // Endpoint classification:
  //   - Passive/read: high limits so passive session polling never triggers
  //     false UX noise (get-session → 60/min, list-accounts → 30/min, etc.)
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
    window: process.env.RATE_LIMIT_WINDOW
      ? parseInt(process.env.RATE_LIMIT_WINDOW)
      : 60,
    max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 20,
    storage: redis ? 'secondary-storage' : 'database',
    customRules: {
      // ── Passive / read endpoints (relaxed — prevent UX noise) ──────────
      '/get-session': { window: 60, max: 60 },
      '/list-accounts': { window: 60, max: 30 },
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