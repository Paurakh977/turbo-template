'use client';

import { useEffect } from 'react';

/**
 * Dashboard segment error boundary.
 *
 * Architecture B: every dashboard render depends on cookie-forwarded calls to
 * the API tier. When the API is briefly unavailable (deploy, restart), the
 * gateway fails fast with 503/504 - this boundary converts that into a clear,
 * retryable message instead of a generic crash page (doc gate 3.7).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Dashboard] segment error:', error);
  }, [error]);

  const unavailable =
    /unavailable|timed out|temporarily/i.test(error.message ?? '');

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold tracking-tight">
          {unavailable ? 'Service temporarily unavailable' : 'Something went wrong'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {unavailable
            ? 'We could not reach the authentication service. This is usually brief - please retry.'
            : 'An unexpected error occurred while loading this page.'}
        </p>
        <button
          onClick={reset}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
