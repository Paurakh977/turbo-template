'use client';

/**
 * Root global error boundary.
 *
 * Catches errors thrown in the root layout itself (where app/error.tsx
 * cannot). Must render its own <html>/<body> per Next.js convention.
 * Reuses the same card copy as SegmentErrorCard without importing it
 * (global-error cannot share the root layout's providers).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error.message ?? '';
  const unavailable = /unavailable|timed out|temporarily|service/i.test(message);
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-2xl border p-6 shadow-sm text-center">
            <h2 className="text-lg font-semibold tracking-tight">
              {unavailable ? 'Service temporarily unavailable' : 'Something went wrong'}
            </h2>
            <p className="mt-2 text-sm opacity-70">
              {unavailable
                ? 'We could not reach the service. This is usually brief - please retry.'
                : 'An unexpected error occurred.' + (error.digest ? ' Reference: ' + error.digest : '')}
            </p>
            <button
              onClick={reset}
              className="mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
