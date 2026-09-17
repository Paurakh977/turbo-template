/**
 * App URL helpers — client-safe (no next/headers import).
 *
 * Server-only helpers (inferOriginFromHeaders / getAppBaseUrl) live in
 * `lib/server/app-url.ts` and must be imported only from server code.
 */

export function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function buildAbsoluteUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Environment-configured app base URL. Resolution order:
 *   1. NEXT_PUBLIC_APP_URL
 *   2. BETTER_AUTH_URL
 *   3. localhost fallback
 */
export function getPublicAppBaseUrl(): string {
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) return trimTrailingSlash(publicAppUrl);

  const authUrl = process.env.BETTER_AUTH_URL?.trim();
  if (authUrl) return trimTrailingSlash(authUrl);

  return 'http://localhost:3000';
}

/**
 * Client-side base URL: falls back to the actual window origin at runtime,
 * which keeps links correct behind proxies even when env vars drift.
 */
export function getClientAppBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }
  return getPublicAppBaseUrl();
}