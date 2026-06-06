// apps/web/src/app/dashboard/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '../../lib/auth-client';
import { getPrimaryRole, hasOperatorRole } from '@repo/auth/roles';
import QRCode from 'react-qr-code';
import React from 'react';
import { motion } from 'framer-motion';
import { ActionDialog } from '../_components/ActionDialog';
import { PasswordInput } from '../_components/PasswordInput';
import { useToast } from '../../lib/toast-context';
import { getRoleBadgeStyle } from '../../lib/role-badge';
import {
  getPasswordStrength,
  validatePasswordPolicy,
} from '../../lib/validation';

type Account = { providerId: string };

export default function DashboardPage() {
  const router = useRouter();
  const {
    data: liveSession,
    isPending,
    error: sessionError,
  } = authClient.useSession();

  // ── Session caching (useRef + sessionStorage for page-refresh resilience) ──
  const SESSION_CACHE_KEY = 'dash-session';
  const SESSION_CACHE_TTL = 5 * 60 * 1000;

  const lastSessionRef = useRef(liveSession);

  // Hydrate from sessionStorage after mount — survives F5/Cmd+R
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > SESSION_CACHE_TTL) {
        sessionStorage.removeItem(SESSION_CACHE_KEY);
        return;
      }
      if (!lastSessionRef.current) {
        lastSessionRef.current = parsed.data;
      }
    } catch {
      // Ignore corrupt cache
    }
  }, []);

  // Keep cache fresh — write to ref + sessionStorage on every successful fetch
  useEffect(() => {
    if (liveSession) {
      lastSessionRef.current = liveSession;
      try {
        sessionStorage.setItem(
          SESSION_CACHE_KEY,
          JSON.stringify({ data: liveSession, ts: Date.now() }),
        );
      } catch {
        // Storage full or unavailable
      }
    }
  }, [liveSession]);

  const session = liveSession ?? lastSessionRef.current;

  // 2FA setup state
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpURI, setTotpURI] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [totpCode, setTotpCode] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupStep, setSetupStep] = useState<'password' | 'qr'>('password');
  const [setupError, setSetupError] = useState('');

  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disablePending, setDisablePending] = useState(false);

  const { pushToast } = useToast();

  // ── Change password modal state ───────────────────────────────────────
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordPending, setChangePasswordPending] = useState(false);

  // ── Rate-limit retry state (MUST be before any early return) ─────────
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState(0);

  // Account listing (used to detect whether a user has a local password/credential)
  const [userAccounts, setUserAccounts] = useState<Account[]>([]);
  const [hasFetchedAccounts, setHasFetchedAccounts] = useState(false);

  useEffect(() => {
    if (session?.user?.id && !isPending && !hasFetchedAccounts) {
      // Mark as fetched up-front so this effect runs at most once per mount
      // for a given session. Resetting on error caused an infinite retry
      // loop (especially under 429 from the auth rate limiter).
      setHasFetchedAccounts(true);
      authClient
        .listAccounts()
        .then((response) => {
          const data = (
            response as {
              data?: Array<{ providerId?: string }> | null;
            }
          ).data;
          const normalized: Account[] = Array.isArray(data)
            ? data
                .map((account) => ({
                  providerId: account.providerId ?? '',
                }))
                .filter((account) => account.providerId.length > 0)
            : [];
          setUserAccounts(normalized);
        })
        .catch((err) => {
          // Keep the guard set; do not retry. We intentionally degrade
          // gracefully (the user just won't see the OAuth-only hint).
          console.warn('[Dashboard] listAccounts failed:', err);
        });
    }
  }, [session?.user?.id, isPending, hasFetchedAccounts]);

  const hasPasswordAccount = userAccounts.some(
    (acc) => acc.providerId === 'credential',
  );
  const isOAuthOnly = hasFetchedAccounts && !hasPasswordAccount;

  useEffect(() => {
    if (!isPending && !liveSession && sessionError?.status !== 429) {
      router.push('/auth');
    }
  }, [liveSession, isPending, router, sessionError]);

  // ── Rate-limit retry — MUST be before the isPending early return ─────────

  const isFirstLoadRateLimited =
    !isPending &&
    !liveSession &&
    sessionError?.status === 429 &&
    !lastSessionRef.current;

  useEffect(() => {
    if (!isFirstLoadRateLimited) {
      setCountdown(0);
      return;
    }
    const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
    setCountdown(Math.ceil(delay / 1000));
    const cd = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    const timer = setTimeout(() => {
      clearInterval(cd);
      authClient
        .getSession()
        .then(({ data }) => {
          if (data) window.location.reload();
          else setRetryCount((c) => c + 1);
        })
        .catch(() => setRetryCount((c) => c + 1));
    }, delay);
    return () => {
      clearTimeout(timer);
      clearInterval(cd);
    };
  }, [isFirstLoadRateLimited, retryCount]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isFirstLoadRateLimited) {
    return (
      <RetryScreen
        countdown={countdown}
        onRetry={async () => {
          try {
            const { data } = await authClient.getSession();
            if (data) window.location.reload();
            else setRetryCount((c) => c + 1);
          } catch {
            setRetryCount((c) => c + 1);
          }
        }}
        onSignOut={async () => {
          await authClient.signOut();
          router.push('/auth');
        }}
      />
    );
  }

  // Degraded state — cached session available, but live fetch is rate limited
  const isDegraded =
    !isPending &&
    !liveSession &&
    sessionError?.status === 429 &&
    lastSessionRef.current != null;

  if (!session) return null;

  // Role extraction for display from canonical role tokens.
  const roleRaw = (session.user as { role?: string }).role ?? 'user';
  const role = getPrimaryRole(roleRaw);

  // Admin check for UI - using Better Auth's checkRolePermission for proper AC system
  const isAdmin =
    authClient.admin.checkRolePermission({
      permissions: { user: ['ban'] },
      role: role as never,
    }) ?? false;
  const isOperator = hasOperatorRole(roleRaw);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push('/auth');
  };

  const handleStopImpersonation = async () => {
    const { error } = await authClient.admin.stopImpersonating();
    if (error) {
      pushToast('error', `Failed to stop impersonation: ${error.message}`);
      return;
    }
    window.location.href = '/dashboard';
  };

  const isImpersonating =
    (session as { session?: { impersonatedBy?: string | null } }).session
      ?.impersonatedBy != null;

  const handleEnable2FA = async () => {
    const password = setupPassword.trim();
    if (!password) {
      setSetupError('Password is required.');
      return;
    }

    const { data, error } = await authClient.twoFactor.enable({
      password,
    });
    if (error) {
      setSetupError(error.message ?? 'Unable to enable 2FA.');
      return;
    }
    if (data) {
      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes);
      setSetupStep('qr');
      setSetupError('');
    }
  };

  const handleVerify2FA = async () => {
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setSetupError('Enter a valid 6-digit code.');
      return;
    }

    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      if (error.status === 429) {
        setSetupError('Too many attempts. Please wait and try again.');
        return;
      }

      if (error.status === 400) {
        setSetupError(error.message ?? 'Invalid code, try again.');
        return;
      }

      setSetupError(
        error.message ?? 'Could not verify code. Please try again.',
      );
    } else {
      setShow2FASetup(false);
      setSetupStep('password');
      setSetupPassword('');
      setTotpCode('');
      setSetupError('');
      pushToast('success', '2FA enabled successfully.');
    }
  };

  const close2FASetup = () => {
    setShow2FASetup(false);
    setSetupStep('password');
    setSetupPassword('');
    setTotpCode('');
    setTotpURI('');
    setBackupCodes([]);
    setSetupError('');
  };

  const handleDisable2FA = async () => {
    const password = disablePassword.trim();
    if (!password) {
      setDisableError('Password is required.');
      return;
    }

    setDisablePending(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        if (error.status === 429) {
          setDisableError(
            'Too many attempts. Please wait a moment and try again.',
          );
          return;
        }
        setDisableError(error.message ?? 'Unable to disable 2FA.');
        return;
      }

      setDisablePassword('');
      setDisableError('');
      setShowDisable2FA(false);
      pushToast('success', '2FA disabled.');
      router.refresh();
    } catch {
      setDisableError(
        'A network error occurred. Please check your connection and try again.',
      );
    } finally {
      setDisablePending(false);
    }
  };

  const handleSetPassword = async () => {
    if (!session?.user?.email) return;
    const { error } = await authClient.requestPasswordReset({
      email: session.user.email,
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      pushToast('error', error.message ?? 'Failed to send reset email.');
    } else {
      pushToast(
        'success',
        `Password setup link sent to ${session.user.email}.`,
      );
    }
  };

  const handleChangePassword = async () => {
    if (!session?.user?.id) return;
    if (!currentPassword || !newPassword) {
      setChangePasswordError('All fields are required.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setChangePasswordError('Passwords do not match.');
      return;
    }
    const passwordError = validatePasswordPolicy(newPassword);
    if (passwordError) {
      setChangePasswordError(passwordError);
      return;
    }

    setChangePasswordPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        if (error.status === 429) {
          setChangePasswordError(
            'Too many attempts. Please wait a moment and try again.',
          );
          return;
        }
        setChangePasswordError(error.message ?? 'Failed to change password.');
        return;
      }
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setChangePasswordError('');
      pushToast(
        'success',
        'Password changed successfully. Other sessions have been signed out.',
      );
    } catch {
      setChangePasswordError(
        'A network error occurred. Please check your connection and try again.',
      );
    } finally {
      setChangePasswordPending(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4 },
    },
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-[760px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 text-foreground no-underline"
          >
            <div className="w-9 h-9 border border-border/80 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-6 h-6 object-contain"
              />
            </div>
            <span className="font-bold text-[17px] tracking-tight">Ozon</span>
          </Link>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <Link
                href="/admin"
                className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Admin Panel
              </Link>
            )}
            {isImpersonating && (
              <button
                onClick={handleStopImpersonation}
                className="text-[13px] font-medium text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
              >
                Stop Impersonating
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="text-[13px] font-medium px-3 py-1.5 rounded-lg border border-border/50 bg-card hover:bg-muted text-foreground transition-colors shadow-sm"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[800px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {isDegraded && (
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
              Connection issue — data may be slightly stale. You&apos;re still
              signed in.
            </span>
          </div>
        )}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-8"
        >
          <motion.div variants={itemVariants}>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              Dashboard
            </h1>
            <p className="text-muted-foreground text-[14px]">
              Welcome back, {session.user.name || session.user.email || 'there'}
              . Here's what's happening.
            </p>
          </motion.div>

          {/* Profile Quick Card */}
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

          {/* Quick Actions Grid */}
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
              <h3 className="mb-1 text-[15px] font-medium text-foreground">
                Notes
              </h3>
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

          {/* Security Overview & Actions */}
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
                  <rect
                    x="3"
                    y="11"
                    width="18"
                    height="11"
                    rx="2"
                    ry="2"
                  ></rect>
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
                  You signed in via{' '}
                  <strong className="text-foreground">
                    {userAccounts[0]?.providerId}
                  </strong>
                  . Password reset is unavailable for OAuth-only accounts. To
                  enable app-level 2FA, first{' '}
                  <button
                    onClick={handleSetPassword}
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
                      {session.user.twoFactorEnabled
                        ? 'Your account is protected by TOTP.'
                        : 'Add an extra layer of security.'}
                    </p>
                  </div>
                  {session.user.twoFactorEnabled ? (
                    <button
                      onClick={() => {
                        setDisablePassword('');
                        setDisableError('');
                        setShowDisable2FA(true);
                      }}
                      disabled={isOAuthOnly}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
                    >
                      Disable 2FA
                    </button>
                  ) : (
                    <button
                      onClick={() => setShow2FASetup(true)}
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
                    onClick={() => {
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmNewPassword('');
                      setChangePasswordError('');
                      setShowChangePassword(true);
                    }}
                    className="text-xs px-4 py-2 bg-muted border border-border/50 text-foreground hover:bg-muted/80 rounded-lg font-medium transition-colors"
                  >
                    Change Password
                  </button>
                ) : (
                  <button
                    onClick={handleSetPassword}
                    className="text-xs px-4 py-2 bg-muted border border-border/50 text-foreground hover:bg-muted/80 rounded-lg font-medium transition-colors"
                  >
                    Set Password
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Admin Tools Quick Access */}
          {isAdmin && (
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
          )}
        </motion.div>
      </main>

      {/* 2FA Setup Modal — uses ActionDialog for focus trap, escape, and ARIA. */}
      <ActionDialog
        open={show2FASetup && setupStep === 'password'}
        title="Set up Two-Factor Auth"
        description="Enter your password to verify your identity."
        confirmLabel="Continue"
        onConfirm={handleEnable2FA}
        onClose={close2FASetup}
      >
        <PasswordInput
          placeholder="Your password"
          value={setupPassword}
          onChange={(e) => {
            setSetupPassword(e.target.value);
            if (setupError) setSetupError('');
          }}
          className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50"
        />
        {setupError ? (
          <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {setupError}
          </p>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={show2FASetup && setupStep === 'qr'}
        title="Scan this QR code"
        description="Open your authenticator app, scan the code, then enter the 6-digit code below."
        confirmLabel="Verify & Enable"
        cancelLabel="Cancel"
        onConfirm={handleVerify2FA}
        onClose={close2FASetup}
      >
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg flex justify-center w-fit mx-auto shadow-sm border border-border/20">
            <QRCode value={totpURI} size={160} />
          </div>
          <input
            type="text"
            aria-label="6-digit verification code"
            placeholder="000000"
            value={totpCode}
            onChange={(e) => {
              setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (setupError) setSetupError('');
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="w-full px-4 py-3 bg-background border border-border/60 rounded-xl text-[18px] outline-none text-center tracking-[0.25em] font-mono"
          />
          {setupError ? (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-xs text-red-300">
              {setupError}
            </p>
          ) : null}

          {backupCodes.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-left">
              <p className="text-[11px] font-bold text-yellow-600 mb-1.5 uppercase">
                Backup Codes (Save all of these)
              </p>
              <p className="mb-2 text-[11px] text-yellow-700 dark:text-yellow-300">
                Store these in a password manager. Each code can only be used
                once.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {backupCodes.map((c: string, i: number) => (
                  <code
                    key={i}
                    className="text-[10px] bg-background/50 border border-border/30 rounded px-1.5 py-0.5 text-center"
                  >
                    {c}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-start pt-1">
            <button
              type="button"
              onClick={() => {
                setSetupStep('password');
                setTotpCode('');
                setSetupError('');
              }}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to password
            </button>
          </div>
        </div>
      </ActionDialog>

      <ActionDialog
        open={showDisable2FA}
        title="Disable two-factor authentication"
        description="Enter your password to remove 2FA protection from this account."
        confirmLabel="Disable 2FA"
        destructive
        pending={disablePending}
        onClose={() => {
          if (disablePending) return;
          setShowDisable2FA(false);
          setDisablePassword('');
          setDisableError('');
        }}
        onConfirm={handleDisable2FA}
      >
        <PasswordInput
          value={disablePassword}
          onChange={(event) => {
            setDisablePassword(event.target.value);
            if (disableError) setDisableError('');
          }}
          placeholder="Confirm password"
          className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
        />
        {disableError ? (
          <p className="mt-2 text-xs text-red-300">{disableError}</p>
        ) : null}
      </ActionDialog>

      <ActionDialog
        open={showChangePassword}
        title="Change Password"
        description="Enter your current password and choose a new one."
        confirmLabel="Change Password"
        pending={changePasswordPending}
        onClose={() => {
          if (changePasswordPending) return;
          setShowChangePassword(false);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
          setChangePasswordError('');
        }}
        onConfirm={handleChangePassword}
      >
        <div className="space-y-3">
          <PasswordInput
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              if (changePasswordError) setChangePasswordError('');
            }}
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          />
          <PasswordInput
            placeholder="New password (min 8 characters)"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (changePasswordError) setChangePasswordError('');
            }}
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          />
          {newPassword ? (
            <p className="text-xs text-muted-foreground">
              Strength:{' '}
              <span className="font-medium text-foreground">
                {getPasswordStrength(newPassword)}
              </span>
            </p>
          ) : null}
          <PasswordInput
            placeholder="Confirm new password"
            value={confirmNewPassword}
            onChange={(e) => {
              setConfirmNewPassword(e.target.value);
              if (changePasswordError) setChangePasswordError('');
            }}
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          />
        </div>
        {changePasswordError ? (
          <p className="mt-2 text-xs text-red-300">{changePasswordError}</p>
        ) : null}
      </ActionDialog>
    </div>
  );
}

// ── Retry screen for rate-limited session (no cached data available) ──
function RetryScreen({
  countdown,
  onRetry,
  onSignOut,
}: {
  countdown: number;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-[760px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 text-foreground no-underline"
          >
            <div className="w-9 h-9 border border-border/80 bg-white rounded-xl flex items-center justify-center shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-6 h-6 object-contain"
              />
            </div>
            <span className="font-bold text-[17px] tracking-tight">Ozon</span>
          </Link>
          <button
            onClick={onSignOut}
            className="text-[13px] font-medium px-3 py-1.5 rounded-lg border border-border/50 bg-card hover:bg-muted text-foreground transition-colors shadow-sm"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
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
            We couldn&apos;t refresh your session. Your data is safe — no
            changes were lost.
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
      </main>
    </div>
  );
}
