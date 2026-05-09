import { headers } from 'next/headers';
import { auth } from '@repo/auth';
import { redirect } from 'next/navigation';
import { SettingsClient } from './_components/SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect('/auth/sign-in');

  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const roleTokens = roleRaw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const role = roleTokens.includes('superAdmin')
    ? 'superAdmin'
    : roleTokens.includes('admin')
      ? 'admin'
      : roleTokens.includes('operator')
        ? 'operator'
        : 'user';

  const [canManageProfile, canManageTheme, canManageLabs, canManageDanger] =
    await Promise.all([
      auth.api.userHasPermission({
        body: { userId: session.user.id, permissions: { settings: ['profile'] } },
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
        body: { userId: session.user.id, permissions: { settings: ['danger'] } },
      }),
    ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-[640px] mx-auto px-6 py-12 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your account preferences
            </p>
          </div>
          <a
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Dashboard
          </a>
        </div>

        <SettingsClient
          user={{
            id:            session.user.id,
            name:          session.user.name,
            email:         session.user.email,
            emailVerified: session.user.emailVerified,
            image:         session.user.image ?? null,
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
