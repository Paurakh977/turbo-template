// apps/web/src/app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '../../lib/auth-client';
import { getPrimaryRole } from '@repo/auth/roles';
import QRCode from 'react-qr-code';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ActionDialog } from '../_components/ActionDialog';
import {
  ToastRegion,
  type ToastItem,
  type ToastKind,
} from '../_components/ToastRegion';

type Account = { providerId: string };

export default function DashboardPage() {
  const router = useRouter();
  const {
    data: session,
    isPending,
    error: sessionError,
  } = authClient.useSession();

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

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Account listing (used to detect whether a user has a local password/credential)
  const [userAccounts, setUserAccounts] = useState<Account[]>([]);
  const [hasFetchedAccounts, setHasFetchedAccounts] = useState(false);

  const pushToast = (kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, message }]);
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismissToast(toast.id), 3500),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts]);

  useEffect(() => {
    if (session?.user?.id && !isPending && !hasFetchedAccounts) {
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
        .catch(() => {
          setHasFetchedAccounts(false);
        });
    }
  }, [session?.user?.id, isPending, hasFetchedAccounts]);

  const hasPasswordAccount = userAccounts
    ? userAccounts.find((acc) => acc.providerId === 'credential')
    : false;
  const isOAuthOnly = hasFetchedAccounts && !hasPasswordAccount;

  useEffect(() => {
    if (!isPending && !session && sessionError?.status !== 429) {
      router.push('/auth');
    }
  }, [session, isPending, router, sessionError]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session && sessionError?.status === 429) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">
        Rate limited. Please wait a moment...
      </div>
    );
  }

  if (!session) return null;

  // Role extraction for display from canonical role tokens.
  const roleRaw = (session.user as any).role ?? 'user';
  const role = getPrimaryRole(roleRaw);

  // Admin check for UI - using Better Auth's checkRolePermission for proper AC system
  const isAdmin =
    authClient.admin.checkRolePermission({
      permissions: { user: ['ban'] },
      role: role as never,
    }) ?? false;
  const isOperator =
    authClient.admin.checkRolePermission({
      permissions: { notes: ['create'] },
      role: role as never,
    }) ?? false;

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

  const isImpersonating = (session as any).session?.impersonatedBy != null;

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
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setSetupError('Enter a valid 6-digit code.');
      return;
    }

    const { error } = await authClient.twoFactor.verifyTotp({ code: totpCode });
    if (error) {
      setSetupError('Invalid code, try again.');
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
    setSetupError('');
  };

  const handleDisable2FA = async () => {
    const password = disablePassword.trim();
    if (!password) {
      setDisableError('Password is required.');
      return;
    }

    setDisablePending(true);
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) {
      setDisableError(error.message ?? 'Unable to disable 2FA.');
      setDisablePending(false);
      return;
    }

    setDisablePending(false);
    setDisablePassword('');
    setDisableError('');
    setShowDisable2FA(false);
    pushToast('success', '2FA disabled.');
    router.refresh();
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

  const ROLE_BADGE_STYLE: Record<string, string> = {
    superAdmin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    admin: 'bg-blue-500/10   text-blue-400   border-blue-500/20',
    operator: 'bg-amber-500/10  text-amber-400  border-amber-500/20',
    user: 'bg-muted text-muted-foreground border-border/50',
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
          <div className="flex items-center gap-3">
            {isAdmin && (
              <Link
                href="/admin"
                className="text-xs px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg font-semibold hover:bg-primary/20 transition-colors"
              >
                Admin Panel
              </Link>
            )}
            {isImpersonating && (
              <button
                onClick={handleStopImpersonation}
                className="text-xs px-3 py-1.5 bg-amber-500/10 text-amber-500 border border-amber-500/30 rounded-lg font-semibold hover:bg-amber-500/20 transition-colors"
              >
                Stop Impersonating
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1.5 px-3 hover:bg-secondary/60 rounded-md"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[800px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
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
              Welcome back, {session.user.name}. Here's what's happening.
            </p>
          </motion.div>

          {/* Profile Quick Card */}
          <motion.div
            variants={itemVariants}
            className="bg-card border border-border/50 rounded-xl p-6 flex items-center gap-6 shadow-sm relative overflow-hidden group"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
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
            <div className="w-16 h-16 rounded-full overflow-hidden border border-border/40 bg-secondary flex items-center justify-center text-xl font-bold text-foreground/50 shadow-inner shrink-0">
              {session.user.image ? (
                <img
                  src={session.user.image}
                  alt="avatar"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
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
                {session.user.name}
              </h2>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${ROLE_BADGE_STYLE[role] ?? ROLE_BADGE_STYLE.user}`}
                >
                  {role}
                </span>
                {session.user.emailVerified && (
                  <span className="text-[10px] font-bold text-green-500/80 uppercase tracking-wider">
                    Verified ✓
                  </span>
                )}
              </div>
            </div>
          </motion.div>

          {/* Quick Actions Grid */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            <Link
              href="/dashboard/notes"
              className="bg-card border border-border/50 rounded-lg p-5 hover:border-primary/40 hover:bg-primary/[0.02] transition-all group flex flex-col"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg
                  width="20"
                  height="20"
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
              <h3 className="font-semibold text-[15px] mb-1">Notes</h3>
              <p className="text-[13px] text-muted-foreground">
                {isOperator
                  ? 'Create and manage your private or shared notes.'
                  : 'View your notes and shared content.'}
              </p>
            </Link>

            <Link
              href="/dashboard/settings"
              className="bg-card border border-border/50 rounded-lg p-5 hover:border-primary/40 hover:bg-primary/[0.02] transition-all group flex flex-col"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <svg
                  width="20"
                  height="20"
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
            className="bg-card border border-border/50 rounded-xl p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[15px] font-semibold flex items-center gap-2">
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
                className="text-xs text-primary hover:underline font-medium"
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
                      {(session.user as any).twoFactorEnabled
                        ? 'Your account is protected by TOTP.'
                        : 'Add an extra layer of security.'}
                    </p>
                  </div>
                  {(session.user as any).twoFactorEnabled ? (
                    <button
                      onClick={() => {
                        setDisablePassword('');
                        setDisableError('');
                        setShowDisable2FA(true);
                      }}
                      disabled={isOAuthOnly}
                      className="text-xs px-4 py-2 border border-red-500/30 text-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                      Disable 2FA
                    </button>
                  ) : (
                    <button
                      onClick={() => setShow2FASetup(true)}
                      disabled={isOAuthOnly}
                      className="text-xs px-4 py-2 bg-foreground text-background hover:bg-foreground/90 rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50"
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
                    Change or reset your login password.
                  </p>
                </div>
                <button
                  onClick={handleSetPassword}
                  className="text-xs px-4 py-2 bg-muted border border-border/50 text-foreground hover:bg-muted/80 rounded-lg font-medium transition-colors"
                >
                  {hasPasswordAccount ? 'Request Reset' : 'Set Password'}
                </button>
              </div>
            </div>
          </motion.div>

          {/* Admin Tools Quick Access */}
          {isAdmin && (
            <motion.div
              variants={itemVariants}
              className="p-6 rounded-xl bg-primary/[0.03] border border-primary/20 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-5">
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
              <h2 className="text-lg font-bold mb-1">Admin Control Center</h2>
              <p className="text-[13px] text-muted-foreground mb-4">
                You have{' '}
                <span className="text-primary font-semibold">{role}</span>{' '}
                privileges.
              </p>
              <div className="flex gap-3 flex-wrap relative z-10">
                <Link
                  href="/admin"
                  className="text-xs px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all font-semibold shadow-sm"
                >
                  Manage Users
                </Link>
                <Link
                  href="/admin/audit"
                  className="text-xs px-4 py-2 bg-secondary border border-border/50 text-foreground rounded-xl hover:bg-secondary/80 transition-all font-semibold"
                >
                  Audit Logs
                </Link>
              </div>
            </motion.div>
          )}
        </motion.div>
      </main>

      {/* 2FA Setup Modal */}
      <AnimatePresence>
        {show2FASetup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-card border border-border/50 rounded-xl p-6 sm:p-8 w-full max-w-[440px] shadow-2xl relative"
            >
              <button
                onClick={close2FASetup}
                className="absolute top-5 right-5 text-muted-foreground hover:text-foreground"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>

              <h3 className="text-xl font-bold mb-6 pr-8">
                Set up Two-Factor Auth
              </h3>

              {setupStep === 'password' && (
                <div className="space-y-4">
                  <p className="text-[13px] text-muted-foreground">
                    Enter your password to verify your identity.
                  </p>
                  <input
                    type="password"
                    placeholder="Your password"
                    value={setupPassword}
                    onChange={(e) => {
                      setSetupPassword(e.target.value);
                      if (setupError) setSetupError('');
                    }}
                    className="w-full px-4 py-2.5 bg-background border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50"
                  />
                  {setupError ? (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                      {setupError}
                    </p>
                  ) : null}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleEnable2FA}
                      className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-[13px] font-semibold"
                    >
                      Continue
                    </button>
                    <button
                      onClick={close2FASetup}
                      className="flex-1 py-2.5 bg-secondary text-secondary-foreground rounded-xl text-[13px] font-medium border border-border/40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {setupStep === 'qr' && (
                <div className="space-y-5 text-center">
                  <p className="text-[13px] text-muted-foreground text-left">
                    Scan this QR code in your authenticator app.
                  </p>
                  <div className="bg-white p-4 rounded-lg flex justify-center w-fit mx-auto shadow-sm border border-border/20">
                    <QRCode value={totpURI} size={160} />
                  </div>
                  <input
                    type="text"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value);
                      if (setupError) setSetupError('');
                    }}
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
                        Backup Codes (Save these!)
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {backupCodes.slice(0, 4).map((c: string, i: number) => (
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

                  <button
                    onClick={handleVerify2FA}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold"
                  >
                    Verify & Enable
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
        <input
          type="password"
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

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
