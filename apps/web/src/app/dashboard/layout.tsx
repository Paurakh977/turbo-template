import { headers } from 'next/headers';
import { getRequestBootstrap } from '../../lib/server/bootstrap';
import { throwUnlessAuth } from '../../lib/server/api-errors';
import { DashboardShell } from './_components/DashboardShell';

export const dynamic = 'force-dynamic';

/**
 * Shared dashboard layout — fetches the request bootstrap ONCE per request
 * (cached via React cache(), see lib/server/bootstrap). Pages reuse the same
 * cached result, so navigation pays 1 bootstrap HTTP + 1 domain HTTP instead
 * of layout session + page bootstrap + data.
 *
 * Architecture B: identity resolved by the API tier over cookie-forwarded
 * HTTP - web holds no DB credentials or signing secret.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  let bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>>;
  try {
    bootstrap = await getRequestBootstrap(h);
  } catch (error) {
    throwUnlessAuth(error);
  }
  if (!bootstrap!.userId) {
    const { redirect } = await import('next/navigation');
    redirect('/auth');
  }

  // DashboardShell expects a Better Auth Session; derive the fields it reads
  // (user.id/name/email/role + session.impersonatedBy) from the bootstrap.
  // Full session lookup is unnecessary — enforcement stays server-side.
  const session = {
    user: {
      id: bootstrap!.sessionUserId,
      name: bootstrap!.sessionUser.name,
      email: bootstrap!.sessionUser.email,
      image: bootstrap!.sessionUser.image,
      role: bootstrap!.role,
    },
    session: {
      impersonatedBy: bootstrap!.impersonatedBy,
    },
  } as unknown as Parameters<typeof DashboardShell>[0]['session'];

  return <DashboardShell session={session}>{children}</DashboardShell>;
}