import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@repo/auth';
import type { Session } from './auth-client';

const ADMIN_ROLES = ['admin', 'superAdmin'] as const;

export async function requireAdmin(): Promise<Session> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) redirect('/auth/sign-in');

  const role = session.user.role as string | null;

  if (!role || !ADMIN_ROLES.includes(role as any)) {
    redirect('/dashboard'); // not an admin — send to regular dashboard
  }

  return session as unknown as Session;
}
