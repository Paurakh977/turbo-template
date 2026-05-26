// app/auth/reset-password/page.tsx
'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '../../../lib/auth-client';
import { PasswordInput } from '../../_components/PasswordInput';
import {
  getPasswordStrength,
  validatePasswordPolicy,
} from '../../../lib/validation';
import { getResetPasswordPublicError } from '../../../lib/auth-errors';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (!token) {
      setError('Invalid or missing reset token.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    });

    if (error) {
      setError(getResetPasswordPublicError(error));
    } else {
      setSuccess('Password set. Redirecting to sign in...');
      setTimeout(() => {
        router.push('/auth');
      }, 2000);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans relative overflow-hidden p-4">
      <div className="relative z-10 bg-card border border-border/50 rounded-xl p-8 sm:p-10 w-full max-w-[420px] shadow-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block no-underline">
            <div className="w-12 h-12 bg-white border border-border/60 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
              <img
                src="/logo.svg"
                alt="Ozon"
                className="w-8 h-8 object-contain"
              />
            </div>
          </Link>
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            Reset Your Password
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Choose a new secure password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <PasswordInput
            placeholder="New password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {password ? (
            <p className="text-xs text-muted-foreground">
              Strength:{' '}
              <span className="font-medium text-foreground">{strength}</span>
            </p>
          ) : null}
          <PasswordInput
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />

          {error && (
            <p className="text-red-500 text-xs bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
              {error}
            </p>
          )}

          {success && (
            <p className="text-emerald-400 text-xs bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-[14px] font-semibold hover:bg-primary/90 transition-all disabled:opacity-70 flex justify-center items-center shadow-sm"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
            ) : (
              'Set Password'
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
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
