import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { db } from '@repo/database';
import { redirect } from 'next/navigation';
import { NotesClient } from './_components/NotesClient';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');

  // Resolve permissions server-side using Better Auth
  const [canCreate, canUpdate, canDelete] = await Promise.all([
    auth.api.userHasPermission({
      body: { userId: session.user.id, permissions: { notes: ['create'] } },
    }),
    auth.api.userHasPermission({
      body: { userId: session.user.id, permissions: { notes: ['update'] } },
    }),
    auth.api.userHasPermission({
      body: { userId: session.user.id, permissions: { notes: ['delete'] } },
    }),
  ]);

  const perms = {
    canCreate: canCreate?.success === true,
    canUpdate: canUpdate?.success === true,
    canDelete: canDelete?.success === true,
  };

  // Read notes directly from DB (Server Component — no route handler needed)
  const notes = await db.note.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[760px] mx-auto px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Notes</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {notes.length} note{notes.length !== 1 ? 's' : ''}
              {!perms.canCreate && (
                <span className="ml-2 text-xs text-muted-foreground/60">
                  (read-only — upgrade role to write)
                </span>
              )}
            </p>
          </div>
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Dashboard
          </a>
        </div>
        <NotesClient
          notes={notes}
          currentUserId={session.user.id}
          perms={perms}
        />
      </div>
    </div>
  );
}
