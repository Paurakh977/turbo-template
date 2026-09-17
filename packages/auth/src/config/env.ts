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
// Inert build-time stand-in used ONLY so that module evaluation during
// `next build` page-data collection never throws. It must NEVER become the
// active signing key: auth.ts refuses to boot the server on it (see
// usingPlaceholderSecret). Treat as public knowledge — anyone can read it here.
export const BUILD_SECRET_PLACEHOLDER = 'build-time-placeholder-secret';
export const secret =
  getEnv('BETTER_AUTH_SECRET', { required: false }) ??
  (isProduction ? BUILD_SECRET_PLACEHOLDER : 'dev-secret');
export const usingPlaceholderSecret =
  isProduction && secret === BUILD_SECRET_PLACEHOLDER;
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

/**
 * Validated integer env parsing. Compose injects tuning knobs as EMPTY
 * strings when unset (`${VAR:-}`), so empty falls back silently; anything
 * else non-numeric crashes at boot instead of handing better-auth NaN or a
 * silently-truncated value (`parseInt("7d") === 7` used to mean 7-second
 * sessions).
 */
export function parseIntEnv(
  name: string,
  fallback: number,
  { min = 1 }: { min?: number } = {},
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  // Digits-only: Number() would happily accept "0x10"/"1e3", looser than the
  // error message promises.
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${name}: "${raw}" must be a whole number >= ${min}.`);
  }
  const value = Number(raw);
  if (value < min) {
    throw new Error(`Invalid ${name}: "${raw}" must be a whole number >= ${min}.`);
  }
  return value;
}