import 'server-only';

import { headers as nextHeaders } from 'next/headers';
import { APIError } from 'better-auth/api';
import {
  DEFAULT_TIMEOUT_MS,
  buildForwardedHeaders,
  internalApiBaseUrl,
  isTimeoutError,
  throwForNonOkResponse,
  throwTimeoutAsApiError,
  throwUnreachableAsApiError,
  toApiStatus,
} from './fetch-internal';

/**
 * JSON client for the API tier's DOMAIN endpoints (notes, audit, rate-limit,
 * users/me/*) - the non-Better-Auth surface built in apps/api.
 *
 * Shares fetch guarantees with auth-http.ts via `./fetch-internal`:
 * cookie/IP/UA forwarding, Origin, 5s timeout, 503/504 mapping, APIError.
 */

export type CallInternalApiOptions = {
  requestHeaders?: Headers;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
   // Booleans allowed (serialized via String(value), skipping undefined) —
  // lets callers pass flags like { withTotal: false } without stringly casts.
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
};

/** Combined identity + permissions (GET /api/users/me/bootstrap). */
export type MyBootstrap = {
  /** Effective user id (acting admin while impersonating). */
  userId: string;
  /** Session owner id (browsed account while impersonating). */
  sessionUserId: string;
  /** SESSION user role (DashboardShell admin-chrome visibility). */
  role: string;
  /** EFFECTIVE user role (enforcement verdicts). */
  effectiveRole: string;
  permissions: { notes: string[]; settings: string[] };
  impersonatedBy: string | null;
  sessionUser: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
  };
  accounts?: Array<{
    id: string;
    providerId: string;
    accountId: string;
  }>;
};

/**
 * One-HTTP bootstrap replacing `getSessionFromApi + getMyPermissions`
 * (was 2 HTTP, 2 session lookups, 2 role reads). Returns session identity
 * plus effective permissions; callers needing only a redirect-on-null check
 * can use `sessionUserId` instead of a separate get-session call.
 * Accepts optional query e.g. `{ with: 'accounts' }` to coalesce linked accounts.
 */
export function getMyBootstrapFromApi(
  requestHeaders?: Headers,
  timeoutMs?: number,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<MyBootstrap> {
  return callInternalApi<MyBootstrap>('/api/users/me/bootstrap', {
    requestHeaders,
    timeoutMs,
    query,
  });
}

export async function callInternalApi<TResponse>(
  path: string,
  options: CallInternalApiOptions = {},
): Promise<TResponse> {
  const {
    method = 'GET',
    body,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  // Architecture B: the web tier holds no auth secret, so every call to the
  // API tier must carry the caller's session cookie. If a call site didn't
  // forward headers explicitly, pull the incoming request headers so cookies
  // (and IP/UA) are propagated automatically. Without this, the API's global
  // AuthGuard 401s and Server Components / actions blow up with "Unauthorized".
  let requestHeaders = options.requestHeaders;
  if (!requestHeaders) {
    try {
      requestHeaders = (await nextHeaders()) as Headers;
    } catch {
      requestHeaders = undefined;
    }
  }

  const url = new URL(path.replace(/^\/+/, ''), `${internalApiBaseUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers = buildForwardedHeaders(requestHeaders);
  if (body !== undefined) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throwTimeoutAsApiError(
        'InternalApi',
        path,
        timeoutMs,
        'The service timed out. Please try again.',
      );
    }
    throwUnreachableAsApiError(
      'InternalApi',
      path,
      error,
      'Service is temporarily unavailable.',
    );
  }

  // 204 No Content (DELETE endpoints)
  if (response.status === 204) {
    if (!response.ok) {
      throw new APIError(toApiStatus(response.status), {});
    }
    return undefined as TResponse;
  }

  const rawText = await response.text();
  let parsed: unknown;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    throwForNonOkResponse(response, parsed, rawText);
  }

  return parsed as TResponse;
}
