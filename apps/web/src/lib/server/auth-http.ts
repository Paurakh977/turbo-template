import 'server-only';

import { APIError } from 'better-auth/api';
import type { Auth } from '@repo/auth';
import { AUTH_BASE_PATH } from '@repo/auth/permissions';

/**
 * Cookie-forwarding HTTP gateway to the API tier's Better Auth endpoints.
 *
 * This is the Architecture B seam (docs/architecture-b-migration.md): web's
 * server code performs auth operations by calling the SAME HTTP endpoints the
 * browser already uses, instead of running a second Better Auth instance with
 * its own DB connection and signing secret.
 *
 * Guarantees:
 * - Cookies are forwarded verbatim so session lookup happens in the API tier.
 * - `Origin` is set to the public app URL so Better Auth's CSRF/trusted-origin
 *   checks accept server-initiated calls (same pattern as packages/database
 *   seed.ts).
 * - `X-Forwarded-For` / `User-Agent` are propagated so API-side rate limiting
 *   and audit rows keep attributing to the real client.
 * - 5s timeout (configurable) and hard failure mapping:
 *     network failure -> 503 SERVICE_UNAVAILABLE (doc gate 3.7)
 *     timeout         -> 504 GATEWAY_TIMEOUT
 *   so Server Components/actions degrade gracefully instead of hanging.
 * - Non-2xx JSON responses are rethrown as `APIError(status, body)` which is
 *   exactly what `auth.api.*` threw locally, so existing call-site error
 *   handling (`isAPIError`, `.status`, `.message`) keeps working unchanged.
 */

type AuthSession = Auth['$Infer']['Session'];

const DEFAULT_TIMEOUT_MS = 5_000;

/** APIError status tokens this gateway can produce. */
type ApiErrorStatus =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'BAD_GATEWAY'
  | 'SERVICE_UNAVAILABLE'
  | 'GATEWAY_TIMEOUT'
  | 'INTERNAL_SERVER_ERROR';

/** Status-line -> APIError status token map (better-auth vocabulary). */
function toApiStatus(status: number): ApiErrorStatus {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 502:
      return 'BAD_GATEWAY';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'GATEWAY_TIMEOUT';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

function internalApiBaseUrl(): string {
  const raw = process.env.INTERNAL_API_URL?.trim();
  if (!raw) {
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message: 'INTERNAL_API_URL is not configured; cannot reach auth API',
    });
  }
  return raw.replace(/\/+$/, '');
}

/**
 * The public origin browsers use. Better Auth's CSRF check validates the
 * Origin header against trustedOrigins, which contains this value.
 */
function publicAppOrigin(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || undefined;
}

export type CallAuthApiOptions = {
  /** Incoming request headers; enables cookie + IP + UA forwarding. */
  requestHeaders?: Headers;
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
};

async function callAuthApi<TResponse>(
  path: string,
  options: CallAuthApiOptions = {},
): Promise<TResponse> {
  const {
    requestHeaders,
    method = 'GET',
    body,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const url = new URL(`${AUTH_BASE_PATH}${path}`, internalApiBaseUrl());
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers();
  headers.set('accept', 'application/json');
  if (body !== undefined) headers.set('content-type', 'application/json');

  const origin = publicAppOrigin();
  if (origin) headers.set('origin', origin);

  if (requestHeaders) {
    const cookie = requestHeaders.get('cookie');
    if (cookie) headers.set('cookie', cookie);

    const forwardedFor = requestHeaders.get('x-forwarded-for');
    if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
    const realIp = requestHeaders.get('x-real-ip');
    if (realIp) headers.set('x-real-ip', realIp);

    const userAgent = requestHeaders.get('user-agent');
    if (userAgent) headers.set('user-agent', userAgent);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never let Next.js data-cache auth responses; they are per-request.
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        (error as { cause?: { name?: string } }).cause?.name ===
          'TimeoutError');
    if (isTimeout) {
      console.error(`[AuthHttp] timeout after ${timeoutMs}ms: ${path}`);
      throw new APIError('GATEWAY_TIMEOUT', {
        message: 'Authentication service timed out. Please try again.',
      });
    }
    console.error(`[AuthHttp] unreachable API for ${path}:`, error);
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Authentication service is temporarily unavailable.',
    });
  }

  const rawText = await response.text();
  let parsed: unknown = undefined;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const errorBody =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : { message: rawText || response.statusText || 'Auth request failed' };
    throw new APIError(toApiStatus(response.status), errorBody);
  }

  return parsed as TResponse;
}

// ---------------------------------------------------------------------------
// Typed endpoint wrappers (shapes verified against better-auth@1.6.29 routes)
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/get-session
 * Returns the session resolved by the API tier from forwarded cookies, or
 * null when unauthenticated (endpoint answers 200 with a null body).
 */
export async function getSessionFromApi(
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<AuthSession | null> {
  const data = await callAuthApi<unknown>('/get-session', {
    requestHeaders,
    timeoutMs,
  });
  if (data && typeof data === 'object' && 'user' in data) {
    return data as AuthSession;
  }
  return null;
}

export type UserHasPermissionInput = {
  userId: string;
  permissions: Record<string, string[]>;
};

export type UserHasPermissionResult = { success: boolean; error?: string };

/**
 * POST /api/auth/admin/has-permission
 *
 * Deliberately does NOT forward cookies: current call sites invoke the local
 * equivalent without headers, keying the check on an explicit userId (the
 * impersonating admin's id when applicable). Keeping the transport identical
 * preserves that semantic exactly.
 */
export async function userHasPermissionFromApi(
  input: UserHasPermissionInput,
  timeoutMs?: number,
): Promise<UserHasPermissionResult | null> {
  return callAuthApi<UserHasPermissionResult | null>('/admin/has-permission', {
    method: 'POST',
    body: input,
    timeoutMs,
  });
}

export type ListUsersQuery = {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  searchField?: string;
  searchValue?: string;
  searchOperator?: 'contains' | 'starts_with' | 'ends_with';
};

/** Minimal shape guaranteed by /admin/list-users entries. */
export type ListedUser = { id: string } & Record<string, unknown>;

export type ListUsersResult = {
  users: ListedUser[];
  total: number;
  limit?: number;
  offset?: number;
};

/**
 * GET /api/auth/admin/list-users — requires forwarded admin cookies.
 */
export async function listUsersFromApi(
  query: ListUsersQuery,
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<ListUsersResult> {
  return callAuthApi<ListUsersResult>('/admin/list-users', {
    requestHeaders,
    query: query as Record<string, string | number | undefined>,
    timeoutMs,
  });
}

/**
 * POST /api/auth/send-verification-email
 *
 * `forwardCookies` defaults to FALSE to mirror the enumeration-safe
 * unauthenticated call the admin action performs today (see
 * apps/web/src/app/admin/actions.ts). Pass true only when sending on behalf
 * of the caller's own identity.
 */
export async function sendVerificationEmailFromApi(
  input: { email: string; callbackURL?: string },
  options: { requestHeaders?: Headers; forwardCookies?: boolean; timeoutMs?: number } = {},
): Promise<{ status: boolean }> {
  const { requestHeaders, forwardCookies = false, timeoutMs } = options;
  return callAuthApi<{ status: boolean }>('/send-verification-email', {
    method: 'POST',
    body: input,
    requestHeaders: forwardCookies ? requestHeaders : undefined,
    timeoutMs,
  });
}

/**
 * POST /api/auth/update-user — applies Set-Cookie side effects via forwarded
 * cookies (session updates flow back to the browser untouched because the
 * browser's original cookies stay authoritative).
 */
export async function updateUserFromApi(
  input: Record<string, unknown>,
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<AuthSession['user'] | null> {
  return callAuthApi<AuthSession['user'] | null>('/update-user', {
    method: 'POST',
    body: input,
    requestHeaders,
    timeoutMs,
  });
}

/**
 * POST /api/auth/request-password-reset
 */
export async function requestPasswordResetFromApi(
  input: { email: string; redirectTo: string },
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<{ status: boolean } | null> {
  return callAuthApi<{ status: boolean } | null>('/request-password-reset', {
    method: 'POST',
    body: input,
    requestHeaders,
    timeoutMs,
  });
}

/**
 * POST /api/auth/delete-user
 */
export async function deleteUserFromApi(
  input: { password?: string; callbackURL: string },
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<unknown> {
  return callAuthApi<unknown>('/delete-user', {
    method: 'POST',
    body: input,
    requestHeaders,
    timeoutMs,
  });
}

export type LinkedAccount = { id: string; providerId: string };

/**
 * GET /api/auth/list-accounts - linked OAuth/credential providers for the
 * session user (replaces web's direct db.account.findMany).
 */
export async function listAccountsFromApi(
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<LinkedAccount[]> {
  const data = await callAuthApi<unknown>('/list-accounts', {
    requestHeaders,
    timeoutMs,
  });
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry): entry is LinkedAccount =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as LinkedAccount).providerId === 'string',
  );
}

export type AdminUserRecord = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  role?: string | null;
  banned?: boolean | null;
};

/**
 * GET /api/auth/admin/get-user?id=... - admin-guarded single-user lookup
 * (replaces web's direct db.user.findUnique in admin actions).
 */
export async function getAdminUserFromApi(
  userId: string,
  requestHeaders: Headers,
  timeoutMs?: number,
): Promise<AdminUserRecord | null> {
  try {
    return await callAuthApi<AdminUserRecord>('/admin/get-user', {
      requestHeaders,
      query: { id: userId },
      timeoutMs,
    });
  } catch (error) {
    // Unknown target user surfaces as 404 from the endpoint.
    if (
      error instanceof APIError &&
      error.status === 404
    ) {
      return null;
    }
    throw error;
  }
}
