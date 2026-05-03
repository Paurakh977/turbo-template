'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '../../../lib/auth-client';

export default function SignUpPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && session) {
      router.replace('/dashboard');
    }
  }, [isPending, router, session]);

  const signUp = async () => {
    setError(null);
    setMessage(null);

    const result = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `${window.location.origin}/dashboard`,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setMessage('Account created. Check your email if verification is required.');
  };

  return (
    <main style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 420 }}>
      <h1>Sign Up</h1>
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
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
      <button onClick={signUp}>Create account</button>
      <a href="/auth/sign-in">Already have an account?</a>
      {message ? <p style={{ color: 'green' }}>{message}</p> : null}
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </main>
  );
}
