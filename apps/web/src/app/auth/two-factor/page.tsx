'use client';

import { useState } from 'react';

import { authClient } from '../../../lib/auth-client';

export default function TwoFactorPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verifyTotp = async () => {
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({
      code,
      trustDevice: true,
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    window.location.href = '/dashboard';
  };

  const verifyOtp = async () => {
    setError(null);
    const result = await authClient.twoFactor.verifyOtp({
      code,
      trustDevice: true,
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    window.location.href = '/dashboard';
  };

  const verifyBackupCode = async () => {
    setError(null);
    const result = await authClient.twoFactor.verifyBackupCode({ code });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    window.location.href = '/dashboard';
  };

  return (
    <main style={{ padding: 24, display: 'grid', gap: 12, maxWidth: 420 }}>
      <h1>Two-Factor Verification</h1>
      <input
        type="text"
        placeholder="Verification code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <button onClick={() => authClient.twoFactor.sendOtp()}>Send Email OTP</button>
      <button onClick={verifyTotp}>Verify TOTP</button>
      <button onClick={verifyOtp}>Verify OTP</button>
      <button onClick={verifyBackupCode}>Verify Backup Code</button>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </main>
  );
}
