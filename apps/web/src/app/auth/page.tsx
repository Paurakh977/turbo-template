'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '../../lib/auth-client';
import { motion, AnimatePresence } from 'framer-motion';
import { PasswordInput } from '../_components/PasswordInput';

export default function AuthPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!isPending && session) {
      router.push('/dashboard');
    }
  }, [session, isPending, router]);

  const [mode, setMode] = useState<'signin' | 'signup' | 'verify-email'>(
    'signin',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
  }>({});
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL as string;
  const appUrl =
    APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  const isEmailValid = (value: string) => /^\S+@\S+\.\S+$/.test(value);

  const validate = () => {
    const nextErrors: { name?: string; email?: string; password?: string } = {};
    const emailValue = email.trim();
    const passwordValue = password.trim();
    const nameValue = name.trim();

    if (!isEmailValid(emailValue)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (passwordValue.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }

    if (mode === 'signup') {
      if (!nameValue) {
        nextErrors.name = 'Name is required.';
      } else if (nameValue.length > 80) {
        nextErrors.name = 'Name must be 80 characters or less.';
      }
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    const { error } = await authClient.sendVerificationEmail({
      email: email.trim(),
      callbackURL: `${appUrl}/dashboard`,
    });
    if (error) setError(error.message ?? 'Failed to resend.');
    else setResendSent(true);
    setResendLoading(false);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setLoading(true);

    if (mode === 'signup') {
      const { error } = await authClient.signUp.email({
        email: email.trim(),
        password,
        name: name.trim(),
        callbackURL: `${appUrl}/dashboard`,
      });
      if (error) {
        setError(error.message ?? 'Sign up failed');
      } else {
        setMode('verify-email');
        setLoading(false);
        return;
      }
    } else {
      const { error } = await authClient.signIn.email(
        { email: email.trim(), password, callbackURL: `${appUrl}/dashboard` },
        {
          onSuccess(ctx) {
            if (ctx.data?.twoFactorRedirect) return;
            router.push('/dashboard');
          },
        },
      );

      if (error) {
        if (error.code === 'EMAIL_NOT_VERIFIED') {
          setMode('verify-email');
          setLoading(false);
          return;
        }
        setError(error.message ?? 'Sign in failed');
      }
    }
    setLoading(false);
  };

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: `${appUrl}/dashboard`,
    });
  };

  const handleGithubSignIn = async () => {
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: `${appUrl}/dashboard`,
    });
  };

  const formVariants = {
    hidden: { opacity: 0, height: 0, overflow: 'hidden' },
    visible: {
      opacity: 1,
      height: 'auto',
      overflow: 'visible',
      transition: { duration: 0.3 },
    },
    exit: {
      opacity: 0,
      height: 0,
      overflow: 'hidden',
      transition: { duration: 0.2 },
    },
  };

  if (isPending) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (mode === 'verify-email') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 bg-card border border-border/40 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm"
        >
          <div className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl border border-primary/20"
            >
              @
            </motion.div>
            <h2 className="text-2xl font-semibold tracking-tight mb-2">
              Check your email
            </h2>
            <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
              We sent a verification link to{' '}
              <strong className="text-foreground font-medium">{email}</strong>.
              Click the link to activate your account.
            </p>

            {resendSent ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-green-500 text-sm font-medium mb-4 bg-green-500/10 py-2.5 rounded-xl border border-green-500/20"
              >
                Verification email resent
              </motion.p>
            ) : (
              <button
                onClick={handleResendVerification}
                disabled={resendLoading}
                className="w-full py-2.5 px-4 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl text-sm font-medium transition-all mb-4 border border-border/50"
              >
                {resendLoading ? 'Sending...' : 'Resend verification email'}
              </button>
            )}

            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

            <button
              onClick={() => {
                setMode('signin');
                setError('');
                setResendSent(false);
                setFieldErrors({});
              }}
              className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              Back to sign in
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block no-underline">
            <motion.div
              layoutId="logo"
              className="w-12 h-12 border border-border/60 bg-white rounded-xl flex items-center justify-center mx-auto mb-5 shadow-sm"
            >
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-8 h-8 object-contain"
              />
            </motion.div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Create an account'}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-2">
            {mode === 'signin'
              ? 'Enter your details to sign in'
              : 'Enter your details to get started'}
          </p>
        </div>

        <div className="space-y-3 mb-6">
          <button
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-background border border-border/60 rounded-xl text-[13px] font-medium hover:bg-muted/50 transition-colors shadow-sm"
          >
            <GoogleIcon /> Continue with Google
          </button>
          <button
            onClick={handleGithubSignIn}
            className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-foreground text-background rounded-xl text-[13px] font-medium hover:opacity-90 transition-opacity shadow-sm"
          >
            <GithubIcon /> Continue with GitHub
          </button>
        </div>

        <div className="relative flex items-center mb-6">
          <div className="flex-grow border-t border-border/60"></div>
          <span className="flex-shrink-0 mx-4 text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
            or
          </span>
          <div className="flex-grow border-t border-border/60"></div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-3.5">
          <AnimatePresence initial={false}>
            {mode === 'signup' && (
              <motion.div
                key="name"
                variants={formVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <input
                  className="w-full px-4 py-3 bg-background/50 border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  maxLength={80}
                  required
                />
                {fieldErrors.name ? (
                  <p className="mt-1 text-xs text-red-500">
                    {fieldErrors.name}
                  </p>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>

          <input
            className="w-full px-4 py-3 bg-background/50 border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            required
          />
          {fieldErrors.email ? (
            <p className="-mt-2 text-xs text-red-500">{fieldErrors.email}</p>
          ) : null}
          <PasswordInput
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
            minLength={8}
            required
          />
          {fieldErrors.password ? (
            <p className="-mt-2 text-xs text-red-500">{fieldErrors.password}</p>
          ) : null}

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <p className="text-red-500 text-xs mt-1 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                  {error}
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
            ) : mode === 'signin' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-[13px] text-muted-foreground">
            {mode === 'signin'
              ? "Don't have an account? "
              : 'Already have an account? '}
            <button
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
                setFieldErrors({});
              }}
              className="text-foreground font-medium hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
          {mode === 'signin' && (
            <p className="text-[13px]">
              <Link
                href="/auth/forgot-password"
                className="text-muted-foreground hover:text-foreground transition-colors font-medium"
              >
                Forgot your password?
              </Link>
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}
