import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@repo/auth';
import { DashboardShell } from './_components/DashboardShell';

export const dynamic = 'force-dynamic';

/**
 * Shared dashboard layout — fetches the session server-side so the shell
 * (header, impersonation banner) is never rendered from a client-side
 * round-trip, then delegates interactive pieces to client components.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth');

  return <DashboardShell session={session}>{children}</DashboardShell>;
}