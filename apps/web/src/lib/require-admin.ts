import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, hasSuperAdminRole, hasAdminRole } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;
export type SessionWithRole = Session & {
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  impersonatedBy: string | null;
};

/**
 * Server-side admin guard.
 *
 * Uses role token check (via hasAdminRole utility from roles.ts) — the most
 * reliable check since it parses the comma-separated role string and checks
 * for 'admin' or 'superAdmin' tokens. This is Better Auth's documented pattern
 * for role-based guards.
 *
 * Impersonation handling: When an admin impersonates another user, the session's
 * user.role reflects the IMPERSONATED user's role (correctly). We allow
 * impersonated admins to access admin features so they can do what that user
 * can do (true meaning of impersonation).
 *
 * Returns the session enriched with:
 * - isSuperAdmin: whether user has superAdmin role
 * - isImpersonating: whether session is being impersonated by another admin
 * - impersonatedBy: the admin ID who started the impersonation (if any)
 */
export async function requireAdmin(): Promise<SessionWithRole> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth/sign-in');

  const impersonatedBy =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null;

  const roleRaw = (session.user as { role?: string }).role ?? 'user';

  if (!hasAdminRole(roleRaw)) {
    redirect('/dashboard');
  }

  return {
    ...session,
    isSuperAdmin: hasSuperAdminRole(roleRaw),
    isImpersonating: impersonatedBy !== null,
    impersonatedBy,
  };
}
