import 'server-only';

import { APIError } from 'better-auth/api';

/**
 * JSON client for the API tier's DOMAIN endpoints (notes, audit, rate-limit,
 * users/me/role) - the non-Better-Auth surface built in apps/api.
 *
 * Mirrors lib/server/auth-http.ts guarantees exactly:
 * - cookie / X-Forwarded-For / x-real-ip / User-Agent forwarding
 * - Origin set to NEXT_PUBLIC_APP_URL
 * - 5s default timeout; network failure -> 503, timeout -> 504
 * - non-2xx rethrown as APIError(status, body)
 */

const DEFAULT_TIMEOUT_MS = 5_000;

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
      message: 'INTERNAL_API_URL is not configured; cannot reach API',
    });
  }
  return raw.replace(/\/+$/, '');
}

function publicAppOrigin(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || undefined
  );
}

export type CallInternalApiOptions = {
  requestHeaders?: Headers;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
};

export async function callInternalApi<TResponse>(
  path: string,
  options: CallInternalApiOptions = {},
): Promise<TResponse> {
  const {
    requestHeaders,
    method = 'GET',
    body,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const url = new URL(path.replace(/^\/+/, ''), `${internalApiBaseUrl()}/`);
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
      console.error(`[InternalApi] timeout after ${timeoutMs}ms: ${path}`);
      throw new APIError('GATEWAY_TIMEOUT', {
        message: 'The service timed out. Please try again.',
      });
    }
    console.error(`[InternalApi] unreachable API for ${path}:`, error);
    throw new APIError('SERVICE_UNAVAILABLE', {
      message: 'Service is temporarily unavailable.',
    });
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
    const errorBody =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : { message: rawText || response.statusText || 'Request failed' };
    throw new APIError(toApiStatus(response.status), errorBody);
  }

  return parsed as TResponse;
}
