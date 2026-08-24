import 'server-only';

import { callInternalApi } from './server/internal-api';

type ServerActionRateLimitInput = {
  scope: string;
  identifier: string;
  windowMs: number;
  max: number;
  failOpen?: boolean;
};

type ServerActionRateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

export function getServerActionRateLimitMessage(retryAfterMs: number): string {
  const waitSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many requests. Please wait ${waitSeconds}s and try again.`;
}

/**
 * Architecture B: server-action rate limiting moved to the API tier's atomic
 * Redis fixed-window limiter (single Lua INCR+EXPIRE round trip). The
 * `identifier` argument is retained for call-site compatibility, but the API
 * derives the bucket key from the authenticated session - a caller can never
 * consume another user's budget.
 *
 * Failure semantics preserved: `failOpen: true` degrades to allowing the
 * request when the limiter is unreachable; default is fail-closed.
 */
export async function checkServerActionRateLimit({
  scope,
  identifier,
  windowMs,
  max,
  failOpen = false,
}: ServerActionRateLimitInput): Promise<ServerActionRateLimitResult> {
  try {
    const decision = await callInternalApi<ServerActionRateLimitResult>(
      '/api/rate-limit/check',
      {
        method: 'POST',
        body: { scope, windowMs, max },
      },
    );
    if (
      typeof decision?.allowed === 'boolean' &&
      typeof decision.retryAfterMs === 'number'
    ) {
      return decision;
    }
    throw new Error('Malformed rate-limit response');
  } catch (error) {
    console.error('[RateLimit] limiter unavailable:', {
      scope,
      identifier,
      error,
    });
    return {
      allowed: failOpen,
      retryAfterMs: failOpen ? 0 : windowMs,
    };
  }
}
