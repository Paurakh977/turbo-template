import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { hasAdminRole } from '@repo/auth/roles';
import { getSessionFromApi, userHasPermissionFromApi } from '../../../lib/server/auth-http';
import { callInternalApi } from '../../../lib/server/internal-api';
import { NotesClient } from './_components/NotesClient';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const h = await headers();
  const session = await getSessionFromApi(h);
  if (!session) redirect('/auth');

  const impersonatedBy =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null;
  const effectivePermissionUserId = impersonatedBy ?? session.user.id;

  // Resolve permissions server-side via the API tier (Architecture B)
  const [canCreate, canUpdate, canDelete, canListAll] = await Promise.all([
    userHasPermissionFromApi({ userId: effectivePermissionUserId, permissions: { notes: ['create'] } }),
    userHasPermissionFromApi({ userId: effectivePermissionUserId, permissions: { notes: ['update'] } }),
    userHasPermissionFromApi({ userId: effectivePermissionUserId, permissions: { notes: ['delete'] } }),
    userHasPermissionFromApi({ userId: effectivePermissionUserId, permissions: { notes: ['list'] } }),
  ]);

  const perms = {
    canCreate: canCreate?.success === true,
    canUpdate: canUpdate?.success === true,
    canDelete: canDelete?.success === true,
    canListAll: canListAll?.success === true,
  };

  // The API returns the effective viewer's FRESH role alongside the
  // already-scoped note list (admins see all, others see their own).
  const { notes, viewerRole } = await callInternalApi<{
    notes: Parameters<typeof NotesClient>[0]['notes'];
    viewerRole: string;
  }>('/api/notes', { requestHeaders: h });

  const isAdmin = hasAdminRole(viewerRole);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Workspace
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Notes
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {notes.length} note{notes.length !== 1 ? 's' : ''}
                {!perms.canCreate ? (
                  <span className="ml-2 text-xs text-muted-foreground/80">
                    read-only access
                  </span>
                ) : null}
              </p>
            </div>
            <Link
              href="/dashboard"
              className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Back
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/50 p-4 shadow-sm sm:p-5">
          <NotesClient
            notes={notes}
            currentUserId={session.user.id}
            perms={perms}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
