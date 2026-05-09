import Link from 'next/link';
import { requireAdmin } from '../../lib/require-admin';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  const roleRaw = (session.user as { role?: string }).role ?? 'admin';
  const roleTokens = roleRaw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const role = roleTokens.includes('superAdmin') ? 'superAdmin' : 'admin';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-card/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Left — branding + role badge */}
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex items-center gap-2 no-underline">
              <span className="text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
                {session.isSuperAdmin ? 'Super Admin' : 'Admin'}
              </span>
            </Link>
            <span className="text-muted-foreground/40">|</span>
            <span className="text-sm text-muted-foreground font-medium truncate max-w-[160px]">
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
          <nav className="flex items-center gap-1">
            <Link
              href="/admin"
              className="text-sm px-3 py-1.5 rounded-lg text-foreground font-medium hover:bg-muted/60 transition-colors"
            >
              Users
            </Link>
            <Link
              href="/admin/audit"
              className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              Audit Log
            </Link>
            <span className="w-px h-4 bg-border/60 mx-1" />
            <Link
              href="/dashboard"
              className="text-sm px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              ← App
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
