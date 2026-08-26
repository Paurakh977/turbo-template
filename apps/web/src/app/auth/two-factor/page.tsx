'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  authClient,
  TWO_FACTOR_CHALLENGE_STORAGE_KEY,
} from '../../../lib/auth-client';
import { motion, AnimatePresence } from 'framer-motion';

type Method = 'totp' | 'otp' | 'backup';
type ChallengeMethod = 'totp' | 'otp';
type TwoFactorError = {
  status?: number;
  message?: string;
  code?: string;
};
type ChallengeSnapshot = {
  methods: ChallengeMethod[];
  issuedAt: number;
};

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

function parseChallengeMethods(raw: string | null): Set<ChallengeMethod> {
  const out = new Set<ChallengeMethod>();
  if (!raw) return out;

  for (const token of raw.split(',')) {
    const value = token.trim().toLowerCase();
    if (value === 'totp' || value === 'otp') {
      out.add(value);
    }
  }

  return out;
}

function isMissingChallengeError(error: TwoFactorError | null | undefined) {
  if (!error) return false;
  if (error.status === 401 || error.status === 403) return true;

  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('two-factor') &&
    (message.includes('required') ||
      message.includes('challenge') ||
      message.includes('expired'))
  );
}

function isRateLimitedError(error: TwoFactorError | null | undefined): boolean {
  return error?.status === 429;
}

function getRateLimitedMessage() {
  return 'Too many attempts. Please wait a moment and try again.';
}

function readChallengeSnapshot(): ChallengeSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(TWO_FACTOR_CHALLENGE_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ChallengeSnapshot>;
    if (!Array.isArray(parsed.methods) || typeof parsed.issuedAt !== 'number') {
      return null;
    }

    const methods = parsed.methods.filter(
      (value): value is ChallengeMethod => value === 'totp' || value === 'otp',
    );

    return {
      methods,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

function clearChallengeSnapshot() {
  try {
    window.sessionStorage.removeItem(TWO_FACTOR_CHALLENGE_STORAGE_KEY);
  } catch {
    // no-op
  }
}

// useSearchParams requires a Suspense boundary for any future static
// prerender (same pattern as reset-password/verify-email pages).
export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorPageInner />
    </Suspense>
  );
}

function TwoFactorPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const challengeMethods = useMemo(
    () => parseChallengeMethods(searchParams.get('methods')),
    [searchParams],
  );

  const [method, setMethod] = useState<Method>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [guardReady, setGuardReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [snapshotMethods, setSnapshotMethods] = useState<Set<ChallengeMethod>>(
    new Set(),
  );

  useEffect(() => {
    const snapshot = readChallengeSnapshot();
    if (!snapshot) return;

    if (Date.now() - snapshot.issuedAt > CHALLENGE_TTL_MS) {
      clearChallengeSnapshot();
      return;
    }

    setSnapshotMethods(new Set(snapshot.methods));
  }, []);

  const availableMethods = useMemo(() => {
    const effectiveChallengeMethods =
      challengeMethods.size > 0 ? challengeMethods : snapshotMethods;

    const options: Method[] = [];
    if (effectiveChallengeMethods.has('totp')) options.push('totp');
    if (effectiveChallengeMethods.has('otp')) options.push('otp');
    options.push('backup');
    return options;
  }, [challengeMethods, snapshotMethods]);

  useEffect(() => {
    if (sessionPending) return;

    if (session) {
      clearChallengeSnapshot();
      router.replace('/dashboard');
      return;
    }

    const effectiveChallengeMethods =
      challengeMethods.size > 0 ? challengeMethods : snapshotMethods;

    if (effectiveChallengeMethods.size === 0) {
      setError('Your verification session has expired. Please sign in again.');
      const timer = window.setTimeout(() => {
        router.replace('/auth');
      }, 1100);
      return () => window.clearTimeout(timer);
    }

    setMethod((current) => {
      if (current === 'backup') return current;
      if (effectiveChallengeMethods.has(current)) return current;
      if (effectiveChallengeMethods.has('totp')) return 'totp';
      if (effectiveChallengeMethods.has('otp')) return 'otp';
      return 'backup';
    });
    setGuardReady(true);
  }, [challengeMethods, router, session, sessionPending, snapshotMethods]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    const effectiveChallengeMethods =
      challengeMethods.size > 0 ? challengeMethods : snapshotMethods;

    if (method !== 'backup' && !effectiveChallengeMethods.has(method)) {
      setError('This verification method is not available for this sign-in.');
      return;
    }

    const nextCode =
      method === 'backup' ? code.trim() : code.replace(/\D/g, '').slice(0, 6);
    setCode(nextCode);

    if (method !== 'backup' && !/^\d{6}$/.test(nextCode)) {
      setError('Enter a valid 6-digit code.');
      return;
    }

    if (method === 'backup' && !nextCode) {
      setError('Backup code is required.');
      return;
    }

    setLoading(true);
    setError('');
    setInfo('');

    try {
      let result;

      if (method === 'totp') {
        result = await authClient.twoFactor.verifyTotp({
          code: nextCode,
          trustDevice,
        });
      } else if (method === 'otp') {
        result = await authClient.twoFactor.verifyOtp({
          code: nextCode,
          trustDevice,
        });
      } else {
        result = await authClient.twoFactor.verifyBackupCode({
          code: nextCode,
          trustDevice,
        });
      }

      if (result.error) {
        if (isMissingChallengeError(result.error as TwoFactorError)) {
          clearChallengeSnapshot();
          setSnapshotMethods(new Set());
          setError(
            'Your verification session has expired. Please sign in again.',
          );
          window.setTimeout(() => {
            router.replace('/auth');
          }, 1100);
          return;
        }
        if (isRateLimitedError(result.error as TwoFactorError)) {
          setError(getRateLimitedMessage());
          return;
        }
        setError(result.error.message ?? 'Invalid code. Please try again.');
      } else {
        clearChallengeSnapshot();
        setSnapshotMethods(new Set());
        router.push('/dashboard');
      }
    } finally {
      // A rejected request (network failure, client upgrade changing
      // throw-vs-error semantics) must never leave the submit button stuck.
      setLoading(false);
    }
  };

  const sendOtp = async () => {
    const effectiveChallengeMethods =
      challengeMethods.size > 0 ? challengeMethods : snapshotMethods;

    if (!effectiveChallengeMethods.has('otp')) {
      setError('Email OTP is not available for this sign-in.');
      return;
    }

    if (otpSending) return;

    setOtpSending(true);
    setError('');
    setInfo('');

    try {
      const { error } = await authClient.twoFactor.sendOtp();
      if (error) {
        if (isMissingChallengeError(error as TwoFactorError)) {
          clearChallengeSnapshot();
          setSnapshotMethods(new Set());
          setError(
            'Your verification session has expired. Please sign in again.',
          );
          window.setTimeout(() => {
            router.replace('/auth');
          }, 1100);
          return;
        }
        if (isRateLimitedError(error as TwoFactorError)) {
          setError(getRateLimitedMessage());
          return;
        }
        setError(error.message ?? 'Failed to send OTP.');
        return;
      }
      setInfo('OTP sent to your email.');
    } finally {
      setOtpSending(false);
    }
  };

  if (sessionPending || !guardReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
        <div className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm text-center">
          <div className="w-8 h-8 mx-auto mb-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">
            {error || 'Preparing verification challenge...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block no-underline">
            <motion.div className="w-16 h-16 bg-white border border-border/60 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-10 h-10 object-contain"
              />
            </motion.div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mb-1.5">
            Two-Step Verification
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Verify your identity to continue
          </p>
        </div>

        {/* Method selector */}
        <div className="flex bg-muted/50 p-1 rounded-xl mb-8 border border-border/40">
          {availableMethods.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMethod(m);
                setCode('');
                setError('');
                setInfo('');
              }}
              className={`flex-1 relative rounded-lg text-[12px] font-medium py-2 transition-colors z-10 ${
                method === m
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {method === m && (
                <motion.div
                  layoutId="method-active"
                  className="absolute inset-0 bg-background border border-border/40 rounded-lg shadow-sm -z-10"
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                />
              )}
              {m === 'totp' ? 'App' : m === 'otp' ? 'Email' : 'Backup'}
            </button>
          ))}
        </div>

        <form onSubmit={handleVerify} className="space-y-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={method}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
            >
              {method === 'totp' && (
                <p className="text-[13px] text-center text-muted-foreground mb-4">
                  Enter the 6-digit code from your authenticator app
                </p>
              )}
              {method === 'otp' && (
                <div className="text-center mb-4">
                  <p className="text-[13px] text-muted-foreground mb-3">
                    Enter the code sent to your email
                  </p>
                  <button
                    type="button"
                    onClick={sendOtp}
                    disabled={otpSending}
                    className="text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md font-medium transition-colors border border-border/50"
                  >
                    {otpSending ? 'Sending...' : 'Send OTP'}
                  </button>
                </div>
              )}
              {method === 'backup' && (
                <p className="text-[13px] text-center text-muted-foreground mb-4">
                  Enter one of your saved backup codes
                </p>
              )}
            </motion.div>
          </AnimatePresence>

          <label
            htmlFor="two-factor-code"
            className="block text-xs font-medium text-muted-foreground"
          >
            {method === 'backup' ? 'Backup code' : 'Verification code'}
          </label>
          <input
            id="two-factor-code"
            className="w-full px-4 py-3.5 bg-background/50 border border-border/60 rounded-xl text-[18px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-center tracking-[0.25em] font-mono placeholder:tracking-normal placeholder:font-sans placeholder:text-muted-foreground/50"
            type="text"
            placeholder={method === 'backup' ? 'Backup code' : '000000'}
            value={code}
            onChange={(e) => {
              const raw = e.target.value;
              setCode(
                method === 'backup' ? raw : raw.replace(/\D/g, '').slice(0, 6),
              );
            }}
            maxLength={method === 'backup' ? 20 : 6}
            required
            autoComplete="one-time-code"
            inputMode={method === 'backup' ? 'text' : 'numeric'}
            pattern={method === 'backup' ? undefined : '[0-9]*'}
          />

          <div className="flex items-center gap-2 px-1 select-none">
            <input
              id="trustDevice"
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="h-4 w-4 rounded border-border/70 bg-background/50 text-primary focus:ring-0 cursor-pointer"
            />
            <label
              htmlFor="trustDevice"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Trust this device for 30 days
            </label>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <p className="text-red-500 text-xs text-center bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                  {error}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {info && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <p className="text-emerald-400 text-xs text-center bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                  {info}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70 flex justify-center items-center shadow-sm"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
              'Verify'
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
