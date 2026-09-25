'use server';

import { headers } from 'next/headers';
import { getRequestBootstrap } from '../../lib/server/bootstrap';
import { classifyApiError } from '../../lib/server/api-errors';
import { checkServerActionRateLimit } from '../../lib/server/server-action-rate-limit';

/**
 * Fetches the caller's CURRENT role straight from the primary store via the
 * API tier. The dashboard caches the session (sessionStorage + in-memory
 * ref) to stay resilient across refreshes; that cache can briefly serve a
 * stale role after an admin changes it. Calling this on mount/tab-focus
 * gives an authoritative answer without waiting for cache TTL or reload.
 */
export async function getFreshRoleAction(): Promise<string | null> {
  try {
    const h = await headers();
    // Bootstrap: identity + fresh SESSION role in 1 HTTP (was
    // getSession + me/role = 2 HTTP). Rate-check runs in PARALLEL:
    // the limiter derives its bucket from the session, so the bootstrap
    // result is not needed first — ~1 wall RTT saved per poll.
    // Polling reuses the request-scoped helper (same fingerprint
    // keys as layout/pages) and classifies bootstrap failures — 401 yields
    // null (signed out), anything else (503/504/timeout) is logged and also
    // yields null WITHOUT masquerading as "not authenticated".
    const [bootstrapResult, rate] = await Promise.all([
      getRequestBootstrap(h)
        .then((b) => ({ ok: true as const, bootstrap: b }))
        .catch((error: unknown) => ({ ok: false as const, error })),
      // Read-only action, but it still hits the store on every tab focus —
      // bound it per user. Fail-open so a limiter hiccup never degrades UI.
      checkServerActionRateLimit({
        scope: 'dashboard:fresh-role',
        windowMs: 60_000,
        max: 30,
        failOpen: true,
      }),
    ]);
    if (!bootstrapResult.ok) {
      const kind = classifyApiError(bootstrapResult.error);
      if (kind !== 'unauthorized') {
        console.error(
          '[Dashboard] getFreshRoleAction bootstrap unavailable:',
          bootstrapResult.error,
        );
      }
      return null;
    }
    const bootstrap = bootstrapResult.bootstrap;
    if (!bootstrap?.userId) return null;
    if (!rate.allowed) return null;

    return bootstrap.role ?? 'user';
  } catch (error) {
    console.error('[Dashboard] getFreshRoleAction failed:', error);
    return null;
  }
}
