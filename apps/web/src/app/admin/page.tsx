import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { requireAdmin } from '../../lib/require-admin';
import { getPrimaryRole } from '@repo/auth/roles';
import { AdminUserTable } from './_components/AdminUserTable';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await requireAdmin();

  const result = await auth.api.listUsers({
    query: {
      limit: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    },
    headers: await headers(),
  });

  const actorRoleRaw = (session.user as { role?: string }).role ?? 'user';
  const actorRole = getPrimaryRole(actorRoleRaw);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          User Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.total} total users
        </p>
      </div>
      <AdminUserTable
        users={result.users}
        total={result.total}
        actorId={session.user.id}
        actorRole={actorRole}
        isSuperAdmin={session.isSuperAdmin}
      />
    </div>
  );
}
