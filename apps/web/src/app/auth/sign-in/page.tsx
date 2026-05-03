'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '../../../lib/auth-client';

export default function SignInPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPending && session) {
      router.replace('/dashboard');
    }
  }, [isPending, router, session]);

  const signInWithEmail = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setNeedsEmailVerification(false);

    const result = await authClient.signIn.email(
      {
        email,
        password,
        callbackURL: `${window.location.origin}/dashboard`,
      },
      {
        onSuccess(context) {
          if (context.data?.twoFactorRedirect) {
            return;
          }
          window.location.href = '/dashboard';
        },
      },
    );

    if (result.error) {
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsEmailVerification(true);
      }
      setError(result.error.message);
      setLoading(false);
      return;
    }

    window.location.href = '/dashboard';
  };

  const resendVerificationEmail = async () => {
    setError(null);
    setInfo(null);

    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${window.location.origin}/auth/verify-email`,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setInfo('Verification email sent. Check your inbox.');
  };

  return (
    <main style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 420 }}>
      <h1>Sign In</h1>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button onClick={signInWithEmail} disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in with email'}
      </button>
      <button
        onClick={() =>
          authClient.signIn.social({
            provider: 'google',
            callbackURL: `${window.location.origin}/dashboard`,
          })
        }
      >
        Continue with Google
      </button>
      <button
        onClick={() =>
          authClient.signIn.social({
            provider: 'github',
            callbackURL: `${window.location.origin}/dashboard`,
          })
        }
      >
        Continue with GitHub
      </button>
      <a href="/auth/sign-up">Create account</a>
      <a href="/auth/forgot-password">Forgot password?</a>
      {needsEmailVerification ? (
        <button onClick={resendVerificationEmail}>Resend verification email</button>
      ) : null}
      {info ? <p style={{ color: 'green' }}>{info}</p> : null}
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </main>
  );
}
