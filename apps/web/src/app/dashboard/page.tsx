// apps/web/src/app/dashboard/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient, listLinkedAccounts, type LinkedAccount } from '../../lib/auth-client';
import { getPrimaryRole, hasOperatorRole } from '@repo/auth/roles';
import { motion } from 'framer-motion';
import { useToast } from '../../lib/toast-context';
import { buildAbsoluteUrl } from '../../lib/app-url';
import {
  getPasswordStrength,
  validatePasswordPolicy,
} from '../../lib/validation';
import { useDashboardSession } from './_components/DashboardShell';
import {
  containerVariants,
  itemVariants,
  ProfileCard,
  QuickActions,
  SecurityPanel,
  AdminToolsPanel,
  DegradedBanner,
  RetryScreen,
} from './_components/dashboard-cards';
import {
  TwoFactorSetupDialog,
  DisableTwoFactorDialog,
  ChangePasswordDialog,
} from './_components/dashboard-modals';

const SESSION_CACHE_KEY = 'dash-session';
const SESSION_CACHE_TTL = 5 * 60 * 1000;

export default function DashboardPage() {
  const router = useRouter();
  const {
    data: liveSession,
    isPending,
    error: sessionError,
  } = authClient.useSession();

  // ── Session caching (useRef + sessionStorage for page-refresh resilience) ──
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
      // Corrupt or unavailable storage — fall through to the live fetch.
    }
  }, []);

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

  // ── Fresh role override ────────────────────────────────────────────────
  // The cached session can serve a stale role (e.g. after an admin promotes
  // or demotes the user). The shell fetches the DB-authoritative role on
  // mount and tab focus, and shares it here via DashboardSessionContext so
  // role-derived UI (badges, admin links, operator actions) stays accurate.
  const { freshRole } = useDashboardSession() ?? {};

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
  const [userAccounts, setUserAccounts] = useState<LinkedAccount[]>([]);
  const [hasFetchedAccounts, setHasFetchedAccounts] = useState(false);

  useEffect(() => {
    if (session?.user?.id && !isPending && !hasFetchedAccounts) {
      // Mark as fetched up-front so this effect runs at most once per mount
      // for a given session. Resetting on error caused an infinite retry
      // loop (especially under 429 from the auth rate limiter).
      setHasFetchedAccounts(true);
      listLinkedAccounts()
        .then((normalized) => {
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
      <div className="flex-1 flex items-center justify-center">
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
  // Prefer the DB-fresh role when available (see fresh role override above).
  const roleRaw =
    freshRole ?? ((session.user as { role?: string }).role ?? 'user');
  const role = getPrimaryRole(roleRaw);

  // Admin check for UI - using Better Auth's checkRolePermission for proper AC system
  const isAdmin =
    authClient.admin.checkRolePermission({
      permissions: { user: ['ban'] },
      role: role as never,
    }) ?? false;
  const isOperator = hasOperatorRole(roleRaw);

  const handleSetPassword = async () => {
    if (!session?.user?.email) return;
    const { error } = await authClient.requestPasswordReset({
      email: session.user.email,
      redirectTo: buildAbsoluteUrl(
        window.location.origin,
        '/auth/reset-password',
      ),
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

  const handleEnable2FA = async () => {
    const password = setupPassword.trim();
    if (!password) {
      setSetupError('Password is required.');
      return;
    }

    const { data, error } = await authClient.twoFactor.enable({ password });
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
      setSetupError(error.message ?? 'Could not verify code. Please try again.');
    } else {
      setShow2FASetup(false);
      setSetupStep('password');
      setSetupPassword('');
      setTotpCode('');
      setSetupError('');
      pushToast('success', '2FA enabled successfully.');
      router.refresh();
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
          setDisableError('Too many attempts. Please wait a moment and try again.');
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

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 py-6 sm:py-10"
    >
      {isDegraded && <DegradedBanner />}

      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Dashboard</h1>
        <p className="text-muted-foreground text-[14px]">
          Welcome back, {session.user.name || session.user.email || 'there'}.
          Here&apos;s what&apos;s happening.
        </p>
      </motion.div>

      <ProfileCard role={role} />

      <QuickActions isOperator={isOperator} />

      <SecurityPanel
        isOAuthOnly={isOAuthOnly}
        providerName={userAccounts[0]?.providerId ?? 'OAuth'}
        hasPasswordAccount={hasPasswordAccount}
        twoFactorEnabled={session.user.twoFactorEnabled === true}
        onSetPassword={handleSetPassword}
        onOpenSetup2FA={() => setShow2FASetup(true)}
        onOpenDisable2FA={() => {
          setDisablePassword('');
          setDisableError('');
          setShowDisable2FA(true);
        }}
        onOpenChangePassword={() => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
          setChangePasswordError('');
          setShowChangePassword(true);
        }}
      />

      {isAdmin && <AdminToolsPanel />}

      <TwoFactorSetupDialog
        open={show2FASetup && setupStep === 'password'}
        openQr={show2FASetup && setupStep === 'qr'}
        step={setupStep}
        password={setupPassword}
        setPassword={setSetupPassword}
        error={setupError}
        setError={setSetupError}
        totpURI={totpURI}
        totpCode={totpCode}
        setTotpCode={setTotpCode}
        backupCodes={backupCodes}
        setStep={setSetupStep}
        onEnable={handleEnable2FA}
        onVerify={handleVerify2FA}
        onClose={close2FASetup}
      />

      <DisableTwoFactorDialog
        open={showDisable2FA}
        password={disablePassword}
        setPassword={setDisablePassword}
        error={disableError}
        setError={setDisableError}
        pending={disablePending}
        onConfirm={handleDisable2FA}
        onClose={() => {
          if (disablePending) return;
          setShowDisable2FA(false);
          setDisablePassword('');
          setDisableError('');
        }}
      />

      <ChangePasswordDialog
        open={showChangePassword}
        currentPassword={currentPassword}
        newPassword={newPassword}
        confirmNewPassword={confirmNewPassword}
        setCurrentPassword={setCurrentPassword}
        setNewPassword={setNewPassword}
        setConfirmNewPassword={setConfirmNewPassword}
        error={changePasswordError}
        setError={setChangePasswordError}
        pending={changePasswordPending}
        onConfirm={handleChangePassword}
        onClose={() => {
          if (changePasswordPending) return;
          setShowChangePassword(false);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmNewPassword('');
          setChangePasswordError('');
        }}
        strength={getPasswordStrength(newPassword)}
      />
    </motion.div>
  );
}