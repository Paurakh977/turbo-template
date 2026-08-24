import { headers } from 'next/headers';
import Link from 'next/link';
import { requireAdmin } from '../../lib/require-admin';
import { getPrimaryRole } from '@repo/auth/roles';
import { listUsersFromApi } from '../../lib/server/auth-http';
import {
  AdminUserTable,
  type AdminTableUser,
} from './_components/AdminUserTable';

/** HTTP JSON -> table row (dates arrive as ISO strings). */
function toTableRow(raw: Record<string, unknown>): AdminTableUser {
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    role: typeof raw.role === 'string' ? raw.role : null,
    banned: typeof raw.banned === 'boolean' ? raw.banned : null,
    banReason: typeof raw.banReason === 'string' ? raw.banReason : undefined,
    emailVerified: raw.emailVerified === true,
    createdAt: new Date(String(raw.createdAt)),
  };
}

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type AdminPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function parsePageParam(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function buildPageHref(
  searchParams: { [key: string]: string | string[] | undefined },
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page' || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  params.set('page', String(page));
  return `/admin?${params.toString()}`;
}

export default async function AdminPage(props: AdminPageProps) {
  const session = await requireAdmin();
  const searchParams = await props.searchParams;
  const requestedPage = parsePageParam(searchParams.page);

  const fetchUsers = async (page: number) => {
    const offset = (page - 1) * PAGE_SIZE;
    return listUsersFromApi(
      {
        limit: PAGE_SIZE,
        offset,
        sortBy: 'createdAt',
        sortDirection: 'desc',
      },
      await headers(),
    );
  };

  let result = await fetchUsers(requestedPage);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);

  if (currentPage !== requestedPage) {
    result = await fetchUsers(currentPage);
  }

  const pageStart = result.total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, result.total);

  const actorRoleRaw = (session.user as { role?: string }).role ?? 'user';
  const actorRole = getPrimaryRole(actorRoleRaw);
  const previousHref = buildPageHref(searchParams, currentPage - 1);
  const nextHref = buildPageHref(searchParams, currentPage + 1);

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
          {result.total} total users - showing {pageStart}-{pageEnd}
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-xs text-muted-foreground">
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Link
              href={previousHref}
              className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-foreground no-underline transition-colors hover:bg-muted"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-md border border-border/40 px-2.5 py-1.5 opacity-50">
              Previous
            </span>
          )}
          {currentPage < totalPages ? (
            <Link
              href={nextHref}
              className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-foreground no-underline transition-colors hover:bg-muted"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-md border border-border/40 px-2.5 py-1.5 opacity-50">
              Next
            </span>
          )}
        </div>
      </div>

      <AdminUserTable
        users={result.users.map(toTableRow)}
        total={result.total}
        actorId={session.user.id}
        actorRole={actorRole}
        isSuperAdmin={session.isSuperAdmin}
      />
    </div>
  );
}
