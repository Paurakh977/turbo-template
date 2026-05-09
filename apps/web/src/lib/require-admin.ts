import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;
export type SessionWithRole = Session & { isSuperAdmin: boolean };

/**
 * Server-side admin guard.
 *
 * Uses auth.api.userHasPermission (the Better Auth documented server-side check)
 * with the actual userId — not just the role string — so it hits the live DB and
 * is not spoofable via cookie manipulation.
 *
 * Returns the session enriched with `isSuperAdmin` so Admin Panel pages can
 * conditionally show superAdmin-only controls without an extra DB call.
 */
export async function requireAdmin(): Promise<SessionWithRole> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth/sign-in');

  // Use userId for a live DB permission check — more secure than role-only check
  const result = await auth.api.userHasPermission({
    body: {
      userId: session.user.id,
      permissions: { user: ['list'] }, // admin+ have this; operator/user do not
    },
  });

  if (!result?.success) redirect('/dashboard');

  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const roles = roleRaw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  return {
    ...session,
    isSuperAdmin: roles.includes('superAdmin'),
  };
}
