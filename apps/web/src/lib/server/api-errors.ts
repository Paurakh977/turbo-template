import 'server-only';

import { redirect, notFound } from 'next/navigation';
import { APIError } from 'better-auth/api';

/**
 * Shared server-side API error classification.
 *
 * Pages must NOT do `.catch(() => null)` + `redirect('/auth')` — that turns
 * 500/502/503/504/timeout/DNS into "not authenticated". Instead:
 *
 *   const bootstrap = await getMyBootstrapFromApi(h).catch(throwUnlessAuth);
 *   // throwUnlessAuth redirects ONLY on 401, throws notFound on 404,
 *   // throws otherwise (route error.tsx renders service error).
 *
 * Next 16.2.0: redirect() only for actual redirects, notFound() for 404,
 * throw for error boundaries. `forbidden`/`unauthorized` file conventions
 * are intentionally not used here — 403 currently surfaces via error.tsx
 * with the API message; add route files when UX needs them.
 */

export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'unavailable'
  | 'bad-request'
  | 'unknown';

export function getApiErrorStatus(error: unknown): number | null {
  if (error instanceof APIError) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  const nested = (error as { status?: unknown })?.status;
  if (typeof nested === 'number') return nested;
  return null;
}

export function classifyApiError(error: unknown): ApiErrorKind {
  const status = getApiErrorStatus(error);
  if (status === null) {
    // Timeout/DNS/unreachable gateway helpers throw APIError with
    // GATEWAY_TIMEOUT/SERVICE_UNAVAILABLE, so a null here means a truly
    // unexpected throw (programming error) — surface as unknown → error.tsx.
    const msg = error instanceof Error ? error.message : '';
    if (/timeout|timed out|abort|fetch failed|enotfound|econn/i.test(msg)) {
      return 'unavailable';
    }
    return 'unknown';
  }
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate-limited';
    case 400:
      return 'bad-request';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'unavailable';
    default:
      return status >= 500 ? 'unavailable' : 'unknown';
  }
}

/**
 * For Server Components: redirects ONLY on 401. 404 → notFound().
 * Everything else rethrows for error.tsx (service error UI, never login).
 */
export function throwUnlessAuth(error: unknown): never {
  const kind = classifyApiError(error);
  if (kind === 'unauthorized') redirect('/auth');
  if (kind === 'not-found') notFound();
  throw error;
}

/**
 * Canonical server-action error message.
 *
 * Single implementation for every use-server action (notes/settings/admin):
 * maps APIError status to a user-safe string, never leaking fetch internals
 * (ECONNREFUSED, stack traces) to the client. Non-APIError throws surface
 * the fallback. 401 has a dedicated message so expired sessions read clearly.
 */
export function toActionErrorMessage(
  error: unknown,
  fallback: string,
  options?: {
    badRequest?: string;
    unauthorized?: string;
    forbidden?: string;
    rateLimited?: string;
  },
): string {
  const messageOf = (e: unknown): string | null => {
    if (e instanceof Error && e.message) return e.message;
    if (
      e &&
      typeof e === 'object' &&
      'message' in e &&
      typeof (e as { message?: unknown }).message === 'string' &&
      (e as { message: string }).message
    ) {
      return (e as { message: string }).message;
    }
    return null;
  };
  const status = getApiErrorStatus(error);
  if (status !== null) {
    switch (status) {
      case 400:
        return options?.badRequest ?? messageOf(error) ?? fallback;
      case 401:
        return options?.unauthorized ?? 'Your session expired. Please sign in again.';
      case 403:
        return options?.forbidden ?? 'You are not allowed to perform this action.';
      case 409:
        return messageOf(error) ?? fallback;
      case 429:
        return options?.rateLimited ?? 'Too many requests. Please wait and try again.';
      default:
        return messageOf(error) ?? fallback;
    }
  }
  // APIError-shaped objects from the mocked better-auth/api in tests carry
  // .status as a string enum; fall through to message-or-fallback.
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    (error as { message: string }).message
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

/** Shaped error return for actions: { error: string }. */
export function toActionError(
  error: unknown,
  fallback: string,
  options?: {
    badRequest?: string;
    unauthorized?: string;
    forbidden?: string;
    rateLimited?: string;
  },
): { error: string } {
  return { error: toActionErrorMessage(error, fallback, options) };
}

/**
 * For parallel bootstrap+data fetches: resolves both, applies auth semantics.
 * If bootstrap is 401 → redirect. If data fails non-401 → throw (error.tsx).
 */
export async function resolvePageData<TBootstrap, TData>(args: {
  bootstrap: Promise<TBootstrap>;
  data: Promise<TData>;
}): Promise<{ bootstrap: TBootstrap; data: TData }> {
  const [bootstrapResult, dataResult] = await Promise.allSettled([
    args.bootstrap,
    args.data,
  ]);
  if (bootstrapResult.status === 'rejected') {
    throwUnlessAuth(bootstrapResult.reason);
  }
  if (dataResult.status === 'rejected') {
    // Data 401 with valid bootstrap = session raced expiry mid-render;
    // treat as auth. Otherwise surface the real error.
    throwUnlessAuth(dataResult.reason);
  }
  return {
    bootstrap: (bootstrapResult as PromiseFulfilledResult<TBootstrap>).value,
    data: (dataResult as PromiseFulfilledResult<TData>).value,
  };
}
