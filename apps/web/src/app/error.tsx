'use client';

import { useEffect } from 'react';

/**
 * Root error boundary. Covers segments without their own error.tsx
 * (notably /admin) so a failed gateway call renders a recoverable page
 * instead of the framework's raw 500 HTML.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Root] unhandled segment error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm text-center">
        <h2 className="text-lg font-semibold tracking-tight">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred while loading this page.
          {error.digest ? ` Reference: ${error.digest}` : ''}
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
