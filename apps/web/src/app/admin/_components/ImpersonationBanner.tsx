'use client';

import { useState } from 'react';
import { authClient } from '../../../lib/auth-client';
import { useToast } from '../../../lib/toast-context';

interface ImpersonationBannerProps {
  userName: string;
  role: string;
}

export function ImpersonationBanner({
  userName,
  role,
}: ImpersonationBannerProps) {
  const [loading, setLoading] = useState(false);
  const { pushToast } = useToast();

  const handleStop = async () => {
    setLoading(true);
    try {
      const { error } = await authClient.admin.stopImpersonating();
      if (error) {
        pushToast(
          'error',
          error.message ?? 'Failed to stop impersonation. Please try again.',
        );
        return;
      }
      // Reload session context completely
      window.location.href = '/dashboard';
    } catch (e) {
      console.error('[Impersonation] Failed to stop impersonation:', e);
      pushToast('error', 'Failed to stop impersonation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-2">
      <span className="text-xs text-amber-500 font-medium">
        You are viewing as {userName} ({role})
      </span>
      <button
        type="button"
        disabled={loading}
        onClick={handleStop}
        className="text-xs text-amber-500 hover:text-amber-400 font-medium underline bg-transparent border-0 cursor-pointer p-0 disabled:opacity-55"
      >
        {loading ? 'Stopping...' : 'Stop impersonating'}
      </button>
    </div>
  );
}
