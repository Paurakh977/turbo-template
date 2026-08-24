import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPrimaryRole } from '@repo/auth/roles';
import {
  getSessionFromApi,
  userHasPermissionFromApi,
  listAccountsFromApi,
} from '../../../lib/server/auth-http';
import { SettingsClient } from './_components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const h = await headers();
  const session = await getSessionFromApi(h);
  if (!session) redirect('/auth');

  const impersonatedBy =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy ?? null;
  const effectiveSettingsPermissionUserId = impersonatedBy ?? session.user.id;

  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const role = getPrimaryRole(roleRaw);

  const [canManageProfile, canManageTheme, canManageLabs, accounts] =
    await Promise.all([
      userHasPermissionFromApi({
        userId: session.user.id,
        permissions: { settings: ['profile'] },
      }),
      userHasPermissionFromApi({
        userId: effectiveSettingsPermissionUserId,
        permissions: { settings: ['theme'] },
      }),
      userHasPermissionFromApi({
        userId: effectiveSettingsPermissionUserId,
        permissions: { settings: ['labs'] },
      }),
      listAccountsFromApi(h),
    ]);

  const hasOAuthAccount = accounts.some(
    (acc) => acc.providerId !== 'credential',
  );
  const hasCredentialAccount = accounts.some(
    (acc) => acc.providerId === 'credential',
  );
  const requiresDeletePassword = hasCredentialAccount;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[680px] space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-medium text-muted-foreground">
                Account
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Settings
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Manage your profile, access, and account safety controls.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
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
          }}
          requiresDeletePassword={requiresDeletePassword}
        />
      </div>
    </div>
  );
}
