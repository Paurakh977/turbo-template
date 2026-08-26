'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '../../../lib/auth-client';
import { motion } from 'framer-motion';
import { isValidEmail } from '../../../lib/validation';
import {
  getForgotPasswordPublicMessage,
  isRateLimitedAuthError,
} from '../../../lib/auth-errors';
import {
  buildAbsoluteUrl,
  getClientAppBaseUrl,
} from '../../../lib/app-url';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [loading, setLoading] = useState(false);
  const appUrl = getClientAppBaseUrl();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim();
    if (!isValidEmail(normalizedEmail)) {
      setFieldError('Enter a valid email address.');
      return;
    }

    setLoading(true);
    setError('');
    setFieldError('');
    try {
      const { error } = await authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: buildAbsoluteUrl(appUrl, '/auth/reset-password'),
      });

      if (error) {
        // Enumeration-safe: better-auth answers success for unknown emails,
        // so an error here means throttling or an availability problem -
        // never surface "account not found" style detail.
        setError(
          isRateLimitedAuthError(error)
            ? getForgotPasswordPublicMessage(error)
            : 'Could not send the reset link right now. Please try again.',
        );
        return;
      }

      setSent(true);
    } catch {
      // The client layer itself rejected (network failure, offline) - the
      // "Check your email" screen would be a lie.
      setError('Could not send the reset link right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm text-center"
        >
          <Link href="/" className="inline-block no-underline">
            <div className="w-16 h-16 bg-white text-primary border border-border/60 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-10 h-10 object-contain"
              />
            </div>
          </Link>
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            Check your email
          </h2>
          <p className="text-muted-foreground text-[14px] leading-relaxed mb-8">
            If an account exists for{' '}
            <strong className="text-foreground">{email}</strong>, you will
            receive a reset link shortly.
          </p>
          <Link
            href="/auth"
            className="inline-block w-full py-3 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-xl text-[14px] font-medium transition-all border border-border/50"
          >
            Back to sign in
          </Link>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm"
      >
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block no-underline">
            <div className="w-14 h-14 bg-white text-secondary-foreground border border-border/60 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-8 h-8 object-contain"
              />
            </div>
          </Link>
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            Reset Password
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Enter your email and we'll send a link
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label
            htmlFor="forgot-email"
            className="block text-xs font-medium text-muted-foreground"
          >
            Email address
          </label>
          <input
            id="forgot-email"
            className="w-full px-4 py-3 bg-background/50 border border-border/60 rounded-xl text-[14px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/70"
            type="email"
            placeholder="Your email address"
            autoComplete="email"
            aria-invalid={fieldError ? 'true' : 'false'}
            aria-describedby={fieldError ? 'forgot-email-error' : undefined}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldError) setFieldError('');
            }}
            required
          />

          {fieldError && (
            <motion.p
              id="forgot-email-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-500 text-xs bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"
            >
              {fieldError}
            </motion.p>
          )}

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-500 text-xs bg-red-500/10 p-2.5 rounded-lg border border-red-500/20"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70 flex justify-center items-center shadow-sm"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
              'Send reset link'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link
            href="/auth"
            className="text-[13px] text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
