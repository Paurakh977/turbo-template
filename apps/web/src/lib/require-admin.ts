import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, hasSuperAdminRole, hasAdminRole } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;
export type SessionWithRole = Session & { isSuperAdmin: boolean };

/**
 * Server-side admin guard.
 *
 * Uses role token check (via hasAdminRole utility from roles.ts) — the most
 * reliable check since it parses the comma-separated role string and checks
 * for 'admin' or 'superAdmin' tokens. This is Better Auth's documented pattern
 * for role-based guards.
 *
 * Returns the session enriched with `isSuperAdmin` so Admin Panel pages can
 * conditionally show superAdmin-only controls without an extra DB call.
 */
export async function requireAdmin(): Promise<SessionWithRole> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth/sign-in');

  const impersonatedBy = (session.user as { impersonatedBy?: string })
    .impersonatedBy;
  if (impersonatedBy) redirect('/dashboard');

  const roleRaw = (session.user as { role?: string }).role ?? 'user';

  if (!hasAdminRole(roleRaw)) {
    redirect('/dashboard');
  }

  return {
    ...session,
    isSuperAdmin: hasSuperAdminRole(roleRaw),
  };
}
