'use client';

import { useState } from 'react';

import { authClient } from '../../../lib/auth-client';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const signInWithEmail = async () => {
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    window.location.href = '/dashboard';
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
      <button onClick={signInWithEmail}>Sign in with email</button>
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
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </main>
  );
}
