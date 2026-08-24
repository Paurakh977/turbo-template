import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionFromApi } from '../../lib/server/auth-http';
import { DashboardShell } from './_components/DashboardShell';

export const dynamic = 'force-dynamic';

/**
 * Shared dashboard layout — fetches the session server-side so the shell
 * (header, impersonation banner) is never rendered from a client-side
 * round-trip, then delegates interactive pieces to client components.
 *
 * Architecture B: the session is resolved by the API tier over
 * cookie-forwarded HTTP - web holds no DB credentials or signing secret.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const session = await getSessionFromApi(h);
  if (!session) redirect('/auth');

  return <DashboardShell session={session}>{children}</DashboardShell>;
}