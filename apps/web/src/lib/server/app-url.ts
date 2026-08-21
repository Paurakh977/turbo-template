import 'server-only';

import { headers } from 'next/headers';
import { getPublicAppBaseUrl, trimTrailingSlash } from '../app-url';

export function inferOriginFromHeaders(h: Headers): string | null {
  const forwardedProto = h
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = h.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? h.get('host')?.split(',')[0]?.trim();
  if (!host) return null;

  const protocol =
    forwardedProto ??
    (host.includes('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https');

  return `${protocol}://${host}`;
}

/**
 * Resolves the app's absolute base URL for a given request.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL (explicitly configured origin)
 *   2. Origin inferred from the incoming request headers (proxy-aware)
 *   3. BETTER_AUTH_URL
 *   4. localhost fallback
 */
export async function getAppBaseUrl(h?: Headers): Promise<string> {
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) return trimTrailingSlash(publicAppUrl);

  const requestHeaders = h ?? (await headers());
  const inferred = inferOriginFromHeaders(requestHeaders);
  if (inferred) return trimTrailingSlash(inferred);

  return getPublicAppBaseUrl();
}