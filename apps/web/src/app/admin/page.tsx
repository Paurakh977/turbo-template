import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { requireAdmin } from '../../lib/require-admin';
import { AdminUserTable } from './_components/AdminUserTable';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireAdmin();

  const result = await auth.api.listUsers({
    query: {
      limit: 50,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    },
    headers: await headers(),
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {result.total} total users
        </p>
      </div>
      <AdminUserTable users={result.users} total={result.total} />
    </div>
  );
}
