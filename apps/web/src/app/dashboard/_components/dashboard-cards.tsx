'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { getRoleBadgeStyle } from '../../../lib/role-badge';
import { useDashboardSession } from './DashboardShell';

// ── Shared animation variants ────────────────────────────────────────────

export const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

export const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4 },
  },
};

// ── Retry screen (rate-limited session, no cached data available) ───────

export function RetryScreen({
  countdown,
  onRetry,
}: {
  countdown: number;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-amber-600 dark:text-amber-400"
          >
            <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
            <path d="M6.16 6.16a9 9 0 0 0 0 11.68" />
            <path d="M10.46 10.46a3 3 0 0 0 0 5.08" />
            <path d="M20.84 20.84a1 1 0 0 1-1.42 1.42l-17-17a1 1 0 0 1 1.42-1.42l5.4 5.4a9 9 0 0 1 10.3 10.3l1.3 1.3z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold tracking-tight mb-2">
          Connection interrupted
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          We couldn&apos;t refresh your session. Your data is safe — no changes
          were lost.
        </p>
        <button
          onClick={onRetry}
          disabled={countdown > 0}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-60 flex items-center justify-center gap-2 shadow-sm"
        >
          {countdown > 0 ? (
            <>
              <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Retrying in {countdown}s
            </>
          ) : (
            'Retry Now'
          )}
        </button>
        <div className="mt-8 text-center">
          <Link
            href="/auth"
            className="text-[13px] text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            Sign in again
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Degraded banner (cached session, live fetch rate-limited) ───────────

export function DegradedBanner() {
  return (
    <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300 flex items-center gap-3">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M18.36 6.64A9 9 0 0 1 20.77 15" />
        <path d="M6.16 6.16a9 9 0 0 0 0 11.68" />
        <path d="M10.46 10.46a3 3 0 0 0 0 5.08" />
        <path d="M20.84 20.84a1 1 0 0 1-1.42 1.42l-17-17a1 1 0 0 1 1.42-1.42l5.4 5.4a9 9 0 0 1 10.3 10.3l1.3 1.3z" />
      </svg>
      <span>
        Connection issue — data may be slightly stale. You&apos;re still signed
        in.
      </span>
    </div>
  );
}

// ── Profile card ─────────────────────────────────────────────────────────

export function ProfileCard({
  role,
}: {
  role: string;
}) {
  const context = useDashboardSession();
  if (!context) return null;
  const { session } = context;

  return (
    <motion.div
      variants={itemVariants}
      className="group relative flex items-center gap-6 overflow-hidden rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border"
    >
      <div className="absolute right-0 top-0 p-4 opacity-5 transition-opacity group-hover:opacity-10 dark:opacity-[0.02] dark:group-hover:opacity-[0.05]">
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xl font-medium text-muted-foreground shadow-inner">
        {session.user.image ? (
          <img
            src={session.user.image}
            alt="avatar"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover rounded-full"
          />
        ) : (
          <span>
            {(session.user.name ?? session.user.email ?? '?')
              .charAt(0)
              .toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-semibold truncate mb-0.5">
          {session.user.name || session.user.email || 'Unnamed user'}
        </h2>
        <div className="mt-1.5 flex items-center gap-2.5">
          <span
            className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${getRoleBadgeStyle(role)}`}
          >
            {role}
          </span>
          {session.user.emailVerified && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Verified
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Quick actions grid ───────────────────────────────────────────────────

export function QuickActions({ isOperator }: { isOperator: boolean }) {
  return (
    <motion.div
      variants={itemVariants}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <Link
        href="/dashboard/notes"
        className="group flex flex-col rounded-2xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-border"
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 transition-transform group-hover:scale-105 dark:text-amber-400">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
            <path d="M15 3v6h6" />
            <path d="M9 18h6" />
            <path d="M9 14h6" />
            <path d="M9 10h1" />
          </svg>
        </div>
        <h3 className="mb-1 text-[15px] font-medium text-foreground">Notes</h3>
        <p className="text-[13px] text-muted-foreground">
          {isOperator
            ? 'Create and manage your private or shared notes.'
            : 'View your notes and shared content.'}
        </p>
      </Link>

      <Link
        href="/dashboard/settings"
        className="group flex flex-col rounded-2xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-border"
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 transition-transform group-hover:scale-105 dark:text-blue-400">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <h3 className="font-semibold text-[15px] mb-1">Settings</h3>
        <p className="text-[13px] text-muted-foreground">
          Manage your profile, security, and account preferences.
        </p>
      </Link>
    </motion.div>
  );
}

// ── Security panel ───────────────────────────────────────────────────────

type SecurityPanelProps = {
  isOAuthOnly: boolean;
  providerName: string;
  hasPasswordAccount: boolean;
  onSetPassword: () => void;
  onOpenSetup2FA: () => void;
  onOpenDisable2FA: () => void;
  onOpenChangePassword: () => void;
  twoFactorEnabled: boolean;
};

export function SecurityPanel({
  isOAuthOnly,
  providerName,
  hasPasswordAccount,
  onSetPassword,
  onOpenSetup2FA,
  onOpenDisable2FA,
  onOpenChangePassword,
  twoFactorEnabled,
}: SecurityPanelProps) {
  return (
    <motion.div
      variants={itemVariants}
      className="rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-border"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[15px] font-medium flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          Security Settings
        </h3>
        <Link
          href="/dashboard/settings"
          className="text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          Advanced Settings →
        </Link>
      </div>

      <div className="space-y-6">
        {isOAuthOnly ? (
          <div className="bg-secondary/50 border border-border/50 rounded-xl p-4 text-[13px] text-muted-foreground leading-relaxed">
            You signed in via <strong className="text-foreground">{providerName}</strong>
            . Password reset is unavailable for OAuth-only accounts. To enable
            app-level 2FA, first{' '}
            <button
              onClick={onSetPassword}
              className="text-primary hover:underline font-medium"
            >
              set a password
            </button>
            .
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-1">
            <div>
              <p className="text-[14px] font-medium text-foreground mb-0.5">
                Two-Factor Authentication
              </p>
              <p className="text-[12px] text-muted-foreground">
                {twoFactorEnabled
                  ? 'Your account is protected by TOTP.'
                  : 'Add an extra layer of security.'}
              </p>
            </div>
            {twoFactorEnabled ? (
              <button
                onClick={onOpenDisable2FA}
                disabled={isOAuthOnly}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
              >
                Disable 2FA
              </button>
            ) : (
              <button
                onClick={onOpenSetup2FA}
                disabled={isOAuthOnly}
                className="rounded-lg border border-transparent bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-sm transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                Enable 2FA
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between py-1 border-t border-border/30 pt-5">
          <div>
            <p className="text-[14px] font-medium text-foreground mb-0.5">
              Account Password
            </p>
            <p className="text-[12px] text-muted-foreground">
              {hasPasswordAccount
                ? 'Change your login password directly.'
                : 'Set a password for your account.'}
            </p>
          </div>
          {hasPasswordAccount ? (
            <button
              onClick={onOpenChangePassword}
              className="text-xs px-4 py-2 bg-muted border border-border/50 text-foreground hover:bg-muted/80 rounded-lg font-medium transition-colors"
            >
              Change Password
            </button>
          ) : (
            <button
              onClick={onSetPassword}
              className="text-xs px-4 py-2 bg-muted border border-border/50 text-foreground hover:bg-muted/80 rounded-lg font-medium transition-colors"
            >
              Set Password
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Admin tools panel ────────────────────────────────────────────────────

export function AdminToolsPanel() {
  return (
    <motion.div
      variants={itemVariants}
      className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.02] p-6 transition-all"
    >
      <div className="absolute right-0 top-0 p-4 opacity-5">
        <svg
          width="100"
          height="100"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      </div>
      <h2 className="mb-1 text-lg font-bold text-foreground">
        Admin Control Center
      </h2>
      <p className="mb-5 text-[13px] text-muted-foreground">
        You have administrative privileges to manage the platform.
      </p>
      <div className="relative z-10 flex flex-wrap gap-3">
        <Link
          href="/admin"
          className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
        >
          Manage Users
        </Link>
        <Link
          href="/admin/audit"
          className="rounded-lg border border-border/60 bg-card px-4 py-2 text-[13px] font-medium text-foreground transition-all hover:bg-muted"
        >
          Audit Logs
        </Link>
      </div>
    </motion.div>
  );
}