import 'server-only';

import { cache } from 'react';
import { getMyBootstrapFromApi, type MyBootstrap } from './internal-api';
import { fingerprintCacheArgs } from './request-fingerprint';

/**
 * Request-scoped dashboard bootstrap.
 *
 * Layout + page both need identity. Without caching that's 2 HTTP
 * (layout get-session + page bootstrap). This module memoizes the bootstrap
 * fetch per request via React `cache()` with PRIMITIVE keys from the
 * canonical request fingerprint (cookie + IP/UA strings — never the Headers
 * object, which is a new wrapper per call). require-admin.ts uses the SAME
 * fingerprint helper so both guards share byte-identical cache keys.
 *
 * Safety: `cache()` is request-scoped, not global — no cross-user leakage.
 * Authz still re-enforced server-side per request; this only saves HTTP.
 *
 * HTTP count:
 *   notes    — layout 1 (bootstrap, cached) + page 0 + notes 1 = 2 total
 *   settings — layout 1 (no accounts) + page 1 (with=accounts, distinct key)
 *              + fallback accounts 0 (coalesced) = 2 total
 *   dashboard root (client page) — layout 1 only = 1 total
 *   admin    — layout 1 (get-session, cached) + page data 1 = 2 total
 *   audit    — requireAdmin 0 (layout-cached) + audit-logs 1 = 1-2 total
 */

const fetchBootstrapCached = cache(
  async (
    cookie: string,
    forwardedFor: string,
    realIp: string,
    userAgent: string,
    withAccounts: string,
  ): Promise<MyBootstrap> => {
    const headers = new Headers();
    if (cookie) headers.set('cookie', cookie);
    if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
    if (realIp) headers.set('x-real-ip', realIp);
    if (userAgent) headers.set('user-agent', userAgent);
    return getMyBootstrapFromApi(
      headers,
      undefined,
      withAccounts ? { with: withAccounts } : undefined,
    );
  },
);

export function getRequestBootstrap(
  requestHeaders: Headers,
  opts?: { with?: string },
): Promise<MyBootstrap> {
  const [cookie, forwardedFor, realIp, userAgent] =
    fingerprintCacheArgs(requestHeaders);
  return fetchBootstrapCached(
    cookie,
    forwardedFor,
    realIp,
    userAgent,
    opts?.with ?? '',
  );
}
