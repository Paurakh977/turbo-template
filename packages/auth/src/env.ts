export function getEnv(name: string, { required = true } = {}): string | undefined {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (required)
    throw new Error(`Missing required environment variable: ${name}`);
  return undefined;
}

export const isProduction = process.env.NODE_ENV === 'production';
export const appName = getEnv('APP_NAME') as string;
// BETTER_AUTH_URL / BETTER_AUTH_SECRET are runtime secrets supplied via
// Compose `environment:`. They must NOT be required at build time (we don't
// want them baked into the image), but the `auth` server instance is
// evaluated during `next build` page-data collection. Fall back to inert
// values at build so module load never throws; the real values (from the
// runtime environment) take effect when the server actually starts.
export const baseURL =
  getEnv('BETTER_AUTH_URL', { required: false }) ??
  (isProduction ? 'http://localhost' : 'http://localhost:3000');
export const appURL = getEnv('NEXT_PUBLIC_APP_URL') as string;
export const secret =
  getEnv('BETTER_AUTH_SECRET', { required: false }) ??
  (isProduction ? 'build-time-placeholder-secret' : 'dev-secret');
export const resendApiKey = getEnv('RESEND_API_KEY', { required: false });
export const devEmailOverride = getEnv('DEV_EMAIL_OVERRIDE', { required: false });
export const emailFrom = getEnv('EMAIL_FROM') as string;
export const redisUrl = getEnv('REDIS_URL', { required: false });

export const googleClientId = getEnv('GOOGLE_CLIENT_ID', { required: false });
export const googleClientSecret = getEnv('GOOGLE_CLIENT_SECRET', { required: false });
export const githubClientId = getEnv('GITHUB_CLIENT_ID', { required: false });
export const githubClientSecret = getEnv('GITHUB_CLIENT_SECRET', { required: false });

export const hasGoogle = Boolean(googleClientId && googleClientSecret);
export const hasGithub = Boolean(githubClientId && githubClientSecret);

export const canSendEmail = Boolean(resendApiKey);