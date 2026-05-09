import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { requireAdmin } from '../../lib/require-admin';
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
  const actorRoleTokens = actorRoleRaw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const actorRole = actorRoleTokens.includes('superAdmin')
    ? 'superAdmin'
    : actorRoleTokens.includes('admin')
      ? 'admin'
      : actorRoleTokens.includes('operator')
        ? 'operator'
        : 'user';

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground text-sm mt-1">
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
