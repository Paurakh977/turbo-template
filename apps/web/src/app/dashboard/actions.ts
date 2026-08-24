'use server';

import { headers } from 'next/headers';
import { getSessionFromApi } from '../../lib/server/auth-http';
import { callInternalApi } from '../../lib/server/internal-api';
import { checkServerActionRateLimit } from '../../lib/server-action-rate-limit';

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
    const session = await getSessionFromApi(h);
    if (!session?.user?.id) return null;

    // Read-only action, but it still hits the store on every tab focus —
    // bound it per user. Fail-open so a limiter hiccup never degrades UI.
    const rate = await checkServerActionRateLimit({
      scope: 'dashboard:fresh-role',
      identifier: session.user.id,
      windowMs: 60_000,
      max: 30,
      failOpen: true,
    });
    if (!rate.allowed) return null;

    const { role } = await callInternalApi<{ role: string }>(
      '/api/users/me/role',
      { requestHeaders: h },
    );
    return role ?? 'user';
  } catch (error) {
    console.error('[Dashboard] getFreshRoleAction failed:', error);
    return null;
  }
}
