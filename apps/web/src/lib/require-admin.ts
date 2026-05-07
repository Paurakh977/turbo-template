import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@repo/auth';

export type Session = typeof auth.$Infer.Session;

export async function requireAdmin(): Promise<Session> {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });

  if (!session) redirect('/auth/sign-in');

  const role = session.user.role as string | null;
  if (!role) redirect('/dashboard');

  const result = await auth.api.userHasPermission({
    body: {
      role: role as 'user' | 'admin' | 'superAdmin',
      permissions: {
        user: ['list'],
      },
    },
  });

  if (!result?.success) redirect('/dashboard');

  return session;
}
