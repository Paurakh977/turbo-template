import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
// Pure role-token helper via subpath - see require-admin.ts rationale.
import { hasOperatorRole } from '@repo/auth/roles';
import type { Auth } from '@repo/auth';
import { auth } from '@repo/auth';

export type Session = Auth['$Infer']['Session'];

/**
 * Server-side operator guard.
 *
 * Uses hasOperatorRole from roles.ts — checks for 'operator' role token in the
 * comma-separated role string. This is the semantically correct check since
 * operator status is determined by role token, not by permission set.
 *
 * The hasOperatorRole utility includes admin and superAdmin in its check,
 * so admins/superAdmins will also pass this guard (they have operator-level access).
 */
export async function requireOperator(): Promise<Session> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth');

  const roleRaw = (session.user as { role?: string }).role ?? 'user';

  if (!hasOperatorRole(roleRaw)) {
    redirect('/dashboard');
  }

  return session;
}
