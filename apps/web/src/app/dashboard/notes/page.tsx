import { headers } from 'next/headers';
import Link from 'next/link';
import { hasAdminRole } from '@repo/auth/roles';
import { callInternalApi } from '../../../lib/server/internal-api';
import { getRequestBootstrap } from '../../../lib/server/bootstrap';
import { resolvePageData } from '../../../lib/server/api-errors';
import { NotesClient } from './_components/NotesClient';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const h = await headers();
  // Layout already fetched the bootstrap (React cache hit — 0 extra HTTP).
  // resolvePageData redirects ONLY on 401; 503/504 throw to error.tsx.
  const { bootstrap, data: notesResult } = await resolvePageData({
    bootstrap: getRequestBootstrap(h),
    // withTotal=false — this page types only {notes, viewerRole} and
    // renders notes.length, so the COUNT(*) total probe is pure waste
    // (saves 1 PG query per page view). Totals remain available by default
    // for any consumer that needs them.
    data: callInternalApi<{
      notes: Parameters<typeof NotesClient>[0]['notes'];
      viewerRole: string;
    }>('/api/notes', {
      requestHeaders: h,
      query: { withTotal: false },
    }),
  });
  if (!bootstrap?.userId) {
    const { redirect } = await import('next/navigation');
    redirect('/auth');
  }
  const { permissions } = bootstrap;
  const sessionUserId = bootstrap.sessionUserId;

  const perms = {
    canCreate: permissions.notes.includes('create'),
    canUpdate: permissions.notes.includes('update'),
    canDelete: permissions.notes.includes('delete'),
    canListAll: permissions.notes.includes('list'),
  };

  // The API returns the effective viewer's FRESH role alongside the
  // already-scoped note list (admins see all, others see their own).
  const { notes, viewerRole } = notesResult;

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
            currentUserId={sessionUserId}
            perms={perms}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
