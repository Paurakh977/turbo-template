import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPrimaryRole } from '@repo/auth/roles';
import { SettingsClient } from './_components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');

  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const role = getPrimaryRole(roleRaw);

  const [canManageProfile, canManageTheme, canManageLabs, canManageDanger] =
    await Promise.all([
      auth.api.userHasPermission({
        body: {
          userId: session.user.id,
          permissions: { settings: ['profile'] },
        },
      }),
      auth.api.userHasPermission({
        body: {
          userId: session.user.id,
          permissions: { settings: ['theme'] },
        },
      }),
      auth.api.userHasPermission({
        body: {
          userId: session.user.id,
          permissions: { settings: ['labs'] },
        },
      }),
      auth.api.userHasPermission({
        body: {
          userId: session.user.id,
          permissions: { settings: ['danger'] },
        },
      }),
    ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[680px] space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Account
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Settings
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your profile, access, and account safety controls.
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

        <SettingsClient
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            emailVerified: session.user.emailVerified,
            image: session.user.image ?? null,
            role,
          }}
          perms={{
            canManageProfile: canManageProfile?.success === true,
            canManageTheme: canManageTheme?.success === true,
            canManageLabs: canManageLabs?.success === true,
            canManageDanger: canManageDanger?.success === true,
          }}
        />
      </div>
    </div>
  );
}
