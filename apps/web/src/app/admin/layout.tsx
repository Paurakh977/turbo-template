import { requireAdmin } from '../../lib/require-admin';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/60 backdrop-blur-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary bg-primary/10 px-2 py-1 rounded-md border border-primary/20">
            Admin
          </span>
          <span className="text-sm text-muted-foreground font-medium">
            {session.user.name}
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <a
            href="/admin"
            className="text-foreground font-medium hover:text-primary transition-colors"
          >
            Users
          </a>
          <a
            href="/admin/audit"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Audit Log
          </a>
          <a
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ← App
          </a>
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
