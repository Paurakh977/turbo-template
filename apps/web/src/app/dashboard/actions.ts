'use server';

import { headers } from 'next/headers';
import { db } from '@repo/database';
import { getSessionFromApi } from '../../lib/server/auth-http';
import { checkServerActionRateLimit } from '../../lib/server-action-rate-limit';

/**
 * Fetches the caller's CURRENT role straight from the primary database.
 *
 * The dashboard caches the session (sessionStorage + in-memory ref) to keep
 * the UI resilient across refreshes. That cache can briefly serve a stale
 * role after an admin changes it. Calling this action on mount and on tab
 * focus gives the dashboard an authoritative, up-to-date role without
 * waiting for the 5-minute cache TTL or a full page reload.
 */
export async function getFreshRoleAction(): Promise<string | null> {
  try {
    const h = await headers();
    const session = await getSessionFromApi(h);
    if (!session?.user?.id) return null;

    // Read-only action, but it still hits the DB on every tab focus — bound
    // it per user. Fail-open so a limiter hiccup never degrades the UI.
    const rate = await checkServerActionRateLimit({
      scope: 'dashboard:fresh-role',
      identifier: session.user.id,
      windowMs: 60_000,
      max: 30,
      failOpen: true,
    });
    if (!rate.allowed) return null;

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (!user) return null;

    return (user.role as string | null | undefined) ?? 'user';
  } catch (error) {
    console.error('[Dashboard] getFreshRoleAction failed:', error);
    return null;
  }
}