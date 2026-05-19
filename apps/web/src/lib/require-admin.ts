import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, hasAdminRole, hasSuperAdminRole } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;
export type SessionWithRole = Session & {
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  impersonatedBy: string | null;
};

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
  const session = await auth.api.getSession({ headers: h });

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
