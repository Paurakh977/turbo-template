import Link from 'next/link';

import { requireAdmin } from '../../lib/require-admin';
import { getPrimaryRole } from '@repo/auth/roles';
import { ImpersonationBanner } from './_components/ImpersonationBanner';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const role = getPrimaryRole(roleRaw);

  return (
    <div className="min-h-screen bg-background">
      {session.isImpersonating && (
        <ImpersonationBanner
          userName={session.user.name ?? session.user.email}
          role={role}
        />
      )}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-card/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          {/* Left — branding + role badge */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/admin"
              className="flex items-center gap-2 no-underline shrink-0"
            >
              <span className="text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
                {session.isSuperAdmin ? 'Super Admin' : 'Admin'}
              </span>
            </Link>
            <span className="text-muted-foreground/40 hidden sm:inline">|</span>
            <span className="text-sm text-muted-foreground font-medium truncate max-w-[110px] sm:max-w-[160px]">
              {session.user.name}
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide hidden sm:inline-flex ${
                role === 'superAdmin'
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}
            >
              {role}
            </span>
          </div>

          {/* Right — nav */}
          <nav className="flex items-center gap-0.5 sm:gap-1 shrink-0 overflow-x-auto">
            <Link
              href="/admin"
              className="text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 rounded-lg text-foreground font-medium hover:bg-muted/60 transition-colors whitespace-nowrap"
            >
              Users
            </Link>
            <Link
              href="/admin/audit"
              className="text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors whitespace-nowrap"
            >
              Audit Log
            </Link>
            <span className="w-px h-4 bg-border/60 mx-1 hidden sm:block" />
            <Link
              href="/dashboard"
              className="text-xs sm:text-sm px-2.5 sm:px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors whitespace-nowrap"
            >
              ← App
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
    </div>
  );
}
