import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
// Pure role-token helpers come from the dedicated subpath so this module
// never instantiates a BetterAuth runtime just to compare role strings.
import { hasAdminRole, hasSuperAdminRole } from '@repo/auth/roles';
import type { Auth } from '@repo/auth';
import { getSessionFromApi } from './auth-http';
import { fingerprintCacheArgs } from './request-fingerprint';

export type Session = Auth['$Infer']['Session'];
export type SessionWithRole = Session & {
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  impersonatedBy: string | null;
};

/**
 * Per-request memo of the admin session fetch:
 * admin layout AND page both call `requireAdmin()` on the same navigation
 * (2× `GET /api/auth/get-session` + 2 session resolutions). React `cache()`
 * is scoped to one request, so this collapses them to one fetch with zero
 * cross-request staleness.
 *
 * Keyed by the canonical request fingerprint (./request-fingerprint) — the
 * SAME four primitives bootstrap.ts uses. `headers()` returns a new wrapper
 * per call, which would defeat the cache; the fingerprint extracts the
 * request-varying inputs `buildForwardedHeaders` propagates (cookie + IP/UA
 * chain + origin comes from env, not the request), so the forwarded request
 * — including the client IP that Better Auth's `/get-session` rate bucket
 * keys on — is byte-identical to uncached.
 */
const getSessionCached = cache(
  async (
    cookie: string | null,
    forwardedFor: string | null,
    realIp: string | null,
    userAgent: string | null,
  ) => {
    const h = new Headers();
    if (cookie) h.set('cookie', cookie);
    if (forwardedFor) h.set('x-forwarded-for', forwardedFor);
    if (realIp) h.set('x-real-ip', realIp);
    if (userAgent) h.set('user-agent', userAgent);
    return getSessionFromApi(h);
  },
);

/**
 * Server-side admin guard.
 *
 * Uses canonical role-token checks (hasAdminRole / hasSuperAdminRole) instead
 * of permission-proxy checks (for example `user: ['ban']`). This keeps the
 * guard aligned with role semantics and avoids accidental access changes if
 * individual permissions are reassigned in the future.
 *
 * Impersonation handling:
 * - Better Auth impersonation sessions expose `session.impersonatedBy`.
 * - Admin routes are intentionally blocked while impersonating.
 * - This prevents elevated-control screens (admin panel, audit) from being
 *   reachable in impersonation mode.
 *
 * Returns the session enriched with:
 * - isSuperAdmin: whether user has superAdmin role
 * - isImpersonating: whether session is being impersonated by another admin
 * - impersonatedBy: the admin ID who started the impersonation (if any)
 */
export async function requireAdmin(): Promise<SessionWithRole> {
  const h = await headers();
  const [cookie, forwardedFor, realIp, userAgent] =
    fingerprintCacheArgs(h);
  const session = await getSessionCached(
    cookie,
    forwardedFor,
    realIp,
    userAgent,
  );

  if (!session) redirect('/auth');

  const impersonatedBy =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null;

  if (impersonatedBy) {
    redirect('/dashboard');
  }

  const sessionRoleRaw = (session.user as { role?: string }).role ?? 'user';

  if (!hasAdminRole(sessionRoleRaw)) {
    redirect('/dashboard');
  }

  return {
    ...session,
    isSuperAdmin: hasSuperAdminRole(sessionRoleRaw),
    isImpersonating: impersonatedBy !== null,
    impersonatedBy,
  };
}
