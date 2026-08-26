'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient, type Session } from '../../../lib/auth-client';
// Canonical role-token checks (same predicates the server-side guards use),
// NOT permission-proxy checks - see lib/require-admin.ts for the rationale.
import { getPrimaryRole, hasAdminRole } from '@repo/auth/roles';
import { getFreshRoleAction } from '../actions';
import { useToast } from '../../../lib/toast-context';

type DashboardSessionValue = {
  session: Session;
  freshRole: string | null;
};

const DashboardSessionContext =
  createContext<DashboardSessionValue | null>(null);

export function useDashboardSession(): DashboardSessionValue | null {
  return useContext(DashboardSessionContext);
}

/**
 * Server-provided session used to seed the client UI before the live
 * authClient.useSession() hook resolves. Kept in a context so the page can
 * avoid a loading flash and render immediately with valid session data.
 * `freshRole` holds the DB-authoritative role, refreshed on mount and tab
 * focus, so role-derived UI (admin links, panels) doesn't go stale while the
 * session cache is valid.
 */
export function DashboardSessionProvider({
  session,
  freshRole,
  children,
}: {
  session: Session;
  freshRole: string | null;
  children: React.ReactNode;
}) {
  return (
    <DashboardSessionContext.Provider value={{ session, freshRole }}>
      {children}
    </DashboardSessionContext.Provider>
  );
}

/**
 * Interactive dashboard shell: header (logo, admin link, impersonation
 * controls, sign out) + impersonation banner. Rendered by the server layout
 * with the authoritative session.
 */
export function DashboardShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const [freshRole, setFreshRole] = useState<string | null>(null);

  const sessionUserId = session.user.id;

  // Fetch the DB-authoritative role on mount and whenever the tab regains
  // focus/visibility, preferring it over the (possibly cached) session role
  // for role-derived UI. Degrades silently — the cached role still works.
  useEffect(() => {
    if (!sessionUserId) return;
    let cancelled = false;

    const refresh = () => {
      getFreshRoleAction()
        .then((role) => {
          if (!cancelled && role) setFreshRole(role);
        })
        .catch(() => {
          // Degrade silently.
        });
    };

    refresh();
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionUserId]);

  const roleRaw =
    freshRole ?? (session.user as { role?: string }).role ?? 'user';
  const role = getPrimaryRole(roleRaw);
  const isAdmin = hasAdminRole(roleRaw);

  const isImpersonating =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy != null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
      router.push('/auth');
    } finally {
      setSigningOut(false);
    }
  };

  const handleStopImpersonation = async () => {
    const { error } = await authClient.admin.stopImpersonating();
    if (error) {
      pushToast('error', `Failed to stop impersonation: ${error.message}`);
      return;
    }
    window.location.href = '/dashboard';
  };

  return (
    <DashboardSessionProvider session={session} freshRole={freshRole}>
      <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
        {isImpersonating && (
          <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-700 dark:text-amber-300 border-b border-amber-500/20">
            <span>
              You are impersonating {session.user.name || session.user.email}
            </span>
            <button
              type="button"
              onClick={handleStopImpersonation}
              className="text-xs font-semibold underline underline-offset-2 hover:opacity-80"
            >
              Stop
            </button>
          </div>
        )}
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
          <div className="max-w-[800px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex items-center gap-3 text-foreground no-underline min-w-0"
            >
              <div className="w-9 h-9 border border-border/80 bg-white rounded-xl flex items-center justify-center shadow-sm shrink-0">
                <img
                  src="/logo.svg"
                  alt="Ozon"
                  className="w-6 h-6 object-contain"
                />
              </div>
              <span className="font-bold text-[17px] tracking-tight truncate">
                Ozon
              </span>
            </Link>
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {isAdmin && (
                <Link
                  href="/admin"
                  className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  Admin Panel
                </Link>
              )}
              {isImpersonating && (
                <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Impersonating
                </span>
              )}
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-[13px] font-medium px-3 py-1.5 rounded-lg border border-border/50 bg-card hover:bg-muted text-foreground transition-colors shadow-sm disabled:opacity-50"
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[800px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {children}
        </main>
      </div>
    </DashboardSessionProvider>
  );
}