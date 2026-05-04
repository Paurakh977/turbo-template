function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const isProduction = process.env.NODE_ENV === 'production';
const appName = getOptionalEnv('APP_NAME') ?? 'MyApp';
const baseURL = getRequiredEnv('BETTER_AUTH_URL');
const appURL = getOptionalEnv('NEXT_PUBLIC_APP_URL') ?? baseURL;
const secret = getRequiredEnv('BETTER_AUTH_SECRET');
const resendApiKey = getOptionalEnv('RESEND_API_KEY');
const devEmailOverride = getOptionalEnv('DEV_EMAIL_OVERRIDE');
const emailFrom =
  getOptionalEnv('EMAIL_FROM') ?? `${appName} <onboarding@resend.dev>`;
const redisUrl = getOptionalEnv('REDIS_URL');
const googleClientId = getOptionalEnv('GOOGLE_CLIENT_ID');
const googleClientSecret = getOptionalEnv('GOOGLE_CLIENT_SECRET');
const githubClientId = getOptionalEnv('GITHUB_CLIENT_ID');
const githubClientSecret = getOptionalEnv('GITHUB_CLIENT_SECRET');
const trustedOrigins = getOptionalEnv('TRUSTED_ORIGINS');

// Session config (no defaults per user request)
const sessionExpiresIn = getOptionalEnv('SESSION_EXPIRES_IN');
const sessionUpdateAge = getOptionalEnv('SESSION_UPDATE_AGE');
const sessionCookieMaxAge = getOptionalEnv('SESSION_COOKIE_MAX_AGE');

// Rate limit config (no defaults)
const rateLimitWindow = getOptionalEnv('RATE_LIMIT_WINDOW');
const rateLimitMax = getOptionalEnv('RATE_LIMIT_MAX');

// Two-factor config (no defaults)
const twoFactorTotpPeriod = getOptionalEnv('TWO_FACTOR_TOTP_PERIOD');
const twoFactorOtpPeriod = getOptionalEnv('TWO_FACTOR_OTP_PERIOD');
const twoFactorOtpAttempts = getOptionalEnv('TWO_FACTOR_OTP_ATTEMPTS');
const twoFactorBackupAmount = getOptionalEnv('TWO_FACTOR_BACKUP_AMOUNT');
const twoFactorBackupLength = getOptionalEnv('TWO_FACTOR_BACKUP_LENGTH');
const twoFactorCookieMaxAge = getOptionalEnv('TWO_FACTOR_COOKIE_MAX_AGE');
const trustDeviceMaxAge = getOptionalEnv('TRUST_DEVICE_MAX_AGE');

const useSecureCookies = baseURL.startsWith('https://');

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseInt(value);
  return isNaN(num) ? undefined : num;
}

export const authEnv = {
  isProduction,
  appName,
  baseURL,
  appURL,
  secret,
  resendApiKey,
  devEmailOverride,
  emailFrom,
  redisUrl,
  googleClientId,
  googleClientSecret,
  githubClientId,
  githubClientSecret,
  trustedOrigins,
  session: {
    expiresIn: parseOptionalInt(sessionExpiresIn),
    updateAge: parseOptionalInt(sessionUpdateAge),
    cookieMaxAge: parseOptionalInt(sessionCookieMaxAge),
  },
  rateLimit: {
    window: parseOptionalInt(rateLimitWindow),
    max: parseOptionalInt(rateLimitMax),
  },
  twoFactor: {
    totpPeriod: parseOptionalInt(twoFactorTotpPeriod),
    otpPeriod: parseOptionalInt(twoFactorOtpPeriod),
    otpAttempts: parseOptionalInt(twoFactorOtpAttempts),
    backupAmount: parseOptionalInt(twoFactorBackupAmount),
    backupLength: parseOptionalInt(twoFactorBackupLength),
    cookieMaxAge: parseOptionalInt(twoFactorCookieMaxAge),
    trustDeviceMaxAge: parseOptionalInt(trustDeviceMaxAge),
  },
  useSecureCookies,
};
