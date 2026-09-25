'use client';

import { useEffect } from 'react';

/**
 * Canonical segment-error UI.
 *
 * Every error.tsx (root, dashboard, admin, auth) renders this card so copy,
 * retry affordance, and 429/5xx distinction stay identical. Server boundaries
 * stay thin wrappers passing through error+reset.
 *
 * 401 must NEVER reach here (pages redirect to /auth before throwing);
 * 404 must NEVER reach here (pages call notFound()). This card therefore
 * distinguishes only:
 * - rate-limited (429 / "too many requests") -> "Slow down" + retry
 * - unavailable (503/504/timeout/DNS)        -> "Service unavailable" + retry
 * - anything else                            -> generic crash + retry + digest
 */
export function SegmentErrorCard({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
}) {
  useEffect(() => {
    console.error('[' + scope + '] segment error:', error);
  }, [error, scope]);

  const message = error.message ?? '';
  const rateLimited = /too many requests|rate.?limit|429/i.test(message);
  const unavailable = /unavailable|timed out|temporarily|service/i.test(message) && !rateLimited;

  const title = rateLimited
    ? 'Slow down a little'
    : unavailable
      ? 'Service temporarily unavailable'
      : 'Something went wrong';
  const body = rateLimited
    ? 'Too many requests from your connection right now. Wait a few seconds and reload.'
    : unavailable
      ? 'We could not reach the service. This is usually brief - please retry.'
      : 'An unexpected error occurred while loading this page.' +
        (error.digest ? ' Reference: ' + error.digest : '');

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
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

/**
 * Canonical segment loading UI.
 *
 * dashboard/loading.tsx and admin/loading.tsx render this skeleton so
 * streaming fallbacks look identical across segments.
 */
export function SegmentLoadingCard({ label }: { label: string }) {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-4" aria-busy="true" aria-live="polite">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm">
        <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
        <div className="mt-3 h-6 w-2/3 rounded bg-muted animate-pulse" />
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
