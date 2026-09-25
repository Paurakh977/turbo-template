import { headers } from 'next/headers';
import Link from 'next/link';
import { getPrimaryRole } from '@repo/auth/roles';
import { listAccountsFromApi } from '../../../lib/server/auth-http';
import { getRequestBootstrap } from '../../../lib/server/bootstrap';
import { throwUnlessAuth } from '../../../lib/server/api-errors';
import { SettingsClient } from './_components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const h = await headers();
  // Combined bootstrap with accounts.
  // Request-cached (layout's base bootstrap is a different cache key, so this
  // is 1 HTTP here — still coalesced identity+perms+accounts vs 3 before).
  // throwUnlessAuth redirects ONLY on 401; 503/504 throw to error.tsx.
  let bootstrap: Awaited<ReturnType<typeof getRequestBootstrap>>;
  try {
    bootstrap = await getRequestBootstrap(h, { with: 'accounts' });
  } catch (error) {
    throwUnlessAuth(error);
  }
  if (!bootstrap?.userId) {
    const { redirect } = await import('next/navigation');
    redirect('/auth');
  }

  let accounts: Array<{ providerId: string }> =
    (bootstrap.accounts as Array<{ providerId: string }> | undefined) ?? [];
  if (accounts.length === 0 && !bootstrap.accounts) {
    try {
      accounts = await listAccountsFromApi(h);
    } catch (error) {
      throwUnlessAuth(error);
    }
  }

  // Display the SESSION user's role (browsed account while impersonating);
  // gating below stays effective-role based (acting admin). Matches
  // pre-refactor display semantics, but fresh from the DB instead of the
  // possibly-stale session snapshot.
  const roleRaw = bootstrap.role ?? 'user';
  const role = getPrimaryRole(roleRaw);
  const perms = bootstrap.permissions;

  const canManageProfile = perms.settings.includes('profile');
  const canManageTheme = perms.settings.includes('theme');
  const canManageLabs = perms.settings.includes('labs');

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
            id: bootstrap.sessionUser.id,
            name: bootstrap.sessionUser.name,
            email: bootstrap.sessionUser.email,
            emailVerified: bootstrap.sessionUser.emailVerified,
            image: bootstrap.sessionUser.image ?? null,
            role,
          }}
          perms={{
            canManageProfile,
            canManageTheme,
            canManageLabs,
          }}
          requiresDeletePassword={requiresDeletePassword}
        />
      </div>
    </div>
  );
}
