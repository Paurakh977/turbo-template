import { db } from '@repo/database';
import type { Prisma, User, Session } from '@prisma/client';

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
}

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { admin } from 'better-auth/plugins/admin';
import { jwt } from 'better-auth/plugins';
import Redis from 'ioredis';
import { Resend } from 'resend';
import { ac, adminRole, superAdminRole, userRole } from './permissions';

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
    return;
  }
  if (devEmailOverride) {
    console.log(
      `[Email] Redirected from ${to} → ${recipient} | Subject: ${subject}`,
    );
  }
}

export const auth: any = betterAuth({
  appName,
  baseURL,
  basePath: '/api/auth',
  secret,

  account: {
    encryptOAuthTokens: true,
  },

  secondaryStorage: redis
    ? {
        get: async (key) => {
          const value = await redis.get(key);
          const isRL =
            key.includes('rate-limit') ||
            key.includes('rl:') ||
            key.includes('|');
          const prefix = isRL ? '🛡️[RateLimit Redis]' : '📦 [Redis Cache]';
          console.log(
            `${prefix} GET ${key} -> ${value ? '🟢 HIT' : '🔴 MISS'}`,
          );
          return value ? value : null;
        },
        set: async (key, value, ttl) => {
          const isRL =
            key.includes('rate-limit') ||
            key.includes('rl:') ||
            key.includes('|');
          const prefix = isRL ? '🛡️ [RateLimit Redis]' : '📦 [Redis Cache]';
          const ttlMsg = ttl ? `(TTL: ${ttl}s)` : '';
          console.log(`${prefix} SET ${key} ${ttlMsg}`);
          if (ttl) await redis.set(key, value, 'EX', ttl);
          else await redis.set(key, value);
        },
        delete: async (key) => {
          const isRL =
            key.includes('rate-limit') ||
            key.includes('rl:') ||
            key.includes('|');
          const prefix = isRL ? '🛡️ [RateLimit Redis]' : '📦[Redis Cache]';
          console.log(`${prefix} DELETE ${key}`);
          await redis.del(key);
        },
      }
    : undefined,

  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),

  databaseHooks: {
    user: {
      create: {
        after: async ({ data }) => {
          if (!data) return;
          const userData = data as unknown as UserData;
          if (!userData?.id) return;
          await db.auditLog.create({
            data: {
              userId: userData.id,
              action: 'user_signed_up',
              metadata: { email: userData.email, name: userData.name },
            },
          });
        },
      },
      update: {
        after: async ({ data, oldData }) => {
          if (!oldData) return;
          const newData = data as unknown as UserData;
          const oldUserData = oldData as unknown as UserData;

          if (oldUserData.role !== newData.role) {
            await db.auditLog.create({
              data: {
                userId: newData.id,
                action: 'role_changed',
                metadata: { from: oldUserData.role, to: newData.role },
              },
            });
          }

          if (!oldUserData.banned && newData.banned) {
            await db.auditLog.create({
              data: {
                userId: newData.id,
                action: 'user_banned',
                metadata: { reason: newData.banReason },
              },
            });
          }

          if (oldUserData.banned && !newData.banned) {
            await db.auditLog.create({
              data: {
                userId: newData.id,
                action: 'user_unbanned',
              },
            });
          }

          if (oldUserData.email !== newData.email) {
            await db.auditLog.create({
              data: {
                userId: newData.id,
                action: 'email_changed',
                metadata: { oldEmail: oldUserData.email },
              },
            });
          }
        },
      },
    },

    session: {
      create: {
        after: async ({ data, ctx }) => {
          if (!data) return;
          const sessionData = data as unknown as SessionData;
          if (!sessionData?.userId) return;
          const context = ctx as unknown as
            | { request?: { headers: { get: (key: string) => string | null } } }
            | undefined;
          await db.auditLog.create({
            data: {
              userId: sessionData.userId,
              action: sessionData.impersonatedBy
                ? 'user_impersonated'
                : 'session_created',
              actor: sessionData.impersonatedBy ?? undefined,
              ipAddress:
                context?.request?.headers.get('x-forwarded-for') ?? undefined,
              userAgent:
                context?.request?.headers.get('user-agent') ?? undefined,
            },
          });
        },
      },
    },
  },

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
      twoFactorEnabled: false,
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

  session: {
    storeSessionInDatabase: true,
    expiresIn: process.env.SESSION_EXPIRES_IN
      ? parseInt(process.env.SESSION_EXPIRES_IN)
      : 60 * 60 * 24 * 7,
    updateAge: process.env.SESSION_UPDATE_AGE
      ? parseInt(process.env.SESSION_UPDATE_AGE)
      : 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: process.env.SESSION_COOKIE_MAX_AGE
        ? parseInt(process.env.SESSION_COOKIE_MAX_AGE)
        : 60 * 5,
      strategy: 'jwe',
    },
  },

  rateLimit: {
    enabled: true,
    window: process.env.RATE_LIMIT_WINDOW
      ? parseInt(process.env.RATE_LIMIT_WINDOW)
      : 60,
    max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 20,
    storage: redis ? 'secondary-storage' : 'database',
    customRules: {
      '/api/auth/sign-in/email': { window: 60, max: 5 },
      '/api/auth/sign-up/email': { window: 60, max: 3 },
      '/api/auth/forget-password': { window: 60, max: 3 },
    },
  },

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

  advanced: {
    useSecureCookies,
    ipAddress: {
      disableIpTracking: false,
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
    backgroundTasks: {
      handler: async (promise) => {
        try {
          await promise; //later add fire-and-forget so they don't block the HTTP response with proper loggins and retry .
        } catch (e) {
          console.error('Better Auth Background Task Failed:', e);
        }
      },
    },
  },

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
          sub: user.id,
          email: user.email,
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
  ],
});

export type Auth = typeof auth;
