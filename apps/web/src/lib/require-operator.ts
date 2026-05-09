import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;

/**
 * Server-side operator guard.
 *
 * Redirects to /dashboard if the user does not have at minimum
 * `notes: ['create']` permission — which only operator, admin, and superAdmin
 * roles possess.
 *
 * Using userId for a live DB check (not just the role string cached in the
 * session cookie) prevents privilege escalation via stale cookies.
 */
export async function requireOperator(): Promise<Session> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth/sign-in');

  const result = await auth.api.userHasPermission({
    body: {
      userId: session.user.id,
      permissions: { notes: ['create'] }, // operator threshold
    },
  });

  if (!result?.success) redirect('/dashboard');

  return session;
}
