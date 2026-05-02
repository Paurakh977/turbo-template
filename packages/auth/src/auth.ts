import { db } from '@repo/database';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';

function getEnv(name: string, { required = true } = {}): string | undefined {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  if (required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return undefined;
}

const isProduction = process.env.NODE_ENV === 'production';

const appName = getEnv('APP_NAME', { required: false }) ?? 'MyApp';
const baseURL = getEnv('BETTER_AUTH_URL') as string;
const secret = getEnv('BETTER_AUTH_SECRET') as string;

const googleClientId = getEnv('GOOGLE_CLIENT_ID', { required: false });
const googleClientSecret = getEnv('GOOGLE_CLIENT_SECRET', { required: false });
const githubClientId = getEnv('GITHUB_CLIENT_ID', { required: false });
const githubClientSecret = getEnv('GITHUB_CLIENT_SECRET', { required: false });

const hasGoogle = Boolean(googleClientId && googleClientSecret);
const hasGithub = Boolean(githubClientId && githubClientSecret);

const trustedOrigins = [
  baseURL,
  ...(getEnv('TRUSTED_ORIGINS', { required: false })
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
];

async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  if (!isProduction) {
    console.log(`[DEV EMAIL] to=${to} subject=${subject} text=${text}`);
    return;
  }

  throw new Error('Production email provider is not configured.');
}

export const auth : any = betterAuth({
  appName,
  baseURL,
  basePath: '/api/auth',
  secret,
  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isProduction,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your password',
        text: `Click to reset your password: ${url}`,
      });
    },
    resetPasswordTokenExpiresIn: 60 * 30,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your email address',
        text: `Click to verify your email: ${url}`,
      });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
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
            scope: ['user:email'],
          },
        }
      : {}),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 60,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
      strategy: 'jwe',
    },
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/forget-password': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
      '/two-factor/verify': { window: 60, max: 5 },
      '/two-factor/send-otp': { window: 60, max: 3 },
      '/get-session': false,
    },
  },
  trustedOrigins,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github'],
    },
    encryptOAuthTokens: true,
  },
  advanced: {
    useSecureCookies: true,
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      ipv6Subnet: 64,
    },
  },
  plugins: [
    twoFactor({
      issuer: appName,
      totpOptions: {
        digits: 6,
        period: 30,
      },
      otpOptions: {
        sendOTP: async ({ user, otp }) => {
          await sendEmail({
            to: user.email,
            subject: 'Your verification code',
            text: `Your verification code is: ${otp}`,
          });
        },
        period: 5,
        digits: 6,
        allowedAttempts: 5,
        storeOTP: 'encrypted',
      },
      backupCodeOptions: {
        amount: 10,
        length: 10,
        storeBackupCodes: 'encrypted',
      },
      twoFactorCookieMaxAge: 10 * 60,
      trustDeviceMaxAge: 30 * 24 * 60 * 60,
    }),
  ],
});

export type Auth = typeof auth;
