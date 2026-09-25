import 'server-only';

import { APIError } from 'better-auth/api';

/**
 * Shared fetch core for Architecture B gateways.
 *
 * `auth-http.ts` (Better Auth endpoints) and `internal-api.ts` (domain
 * endpoints) were ~80% identical: base URL, Origin, cookie/IP/UA forwarding,
 * 5s timeout, 503/504 mapping, non-2xx → APIError. Duplication risked
 * divergent timeout/CSRF behavior. This module is the single implementation;
 * both gateways are thin wrappers preserving their exact public contracts
 * (auth-http: GET|POST + AUTH_BASE_PATH prefix; internal-api: adds PATCH|
 * DELETE, 204 handling, nextHeaders() fallback).
 */

export const DEFAULT_TIMEOUT_MS = 5_000;

export type ApiErrorStatus =
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

export function toApiStatus(status: number): ApiErrorStatus {
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

export function internalApiBaseUrl(): string {
  const raw = process.env.INTERNAL_API_URL?.trim();
  if (!raw) {
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message:
        'INTERNAL_API_URL is not set - the web tier cannot reach the API. ' +
        'Docker Compose injects it (http://api:3001); for host runs add ' +
        "'INTERNAL_API_URL=http://localhost:3001' to .env and start the API.",
    });
  }
  return raw.replace(/\/+$/, '');
}

export function publicAppOrigin(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || undefined;
}

/** Cookie + X-Forwarded-For + x-real-ip + User-Agent forwarding (verbatim). */
export function buildForwardedHeaders(requestHeaders?: Headers): Headers {
  const headers = new Headers();
  headers.set('accept', 'application/json');
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
  return headers;
}

export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.name === 'AbortError' ||
      (error as { cause?: { name?: string } }).cause?.name === 'TimeoutError')
  );
}

export function throwTimeoutAsApiError(
  logPrefix: string,
  path: string,
  timeoutMs: number,
  message: string,
): never {
  console.error(`[${logPrefix}] timeout after ${timeoutMs}ms: ${path}`);
  throw new APIError('GATEWAY_TIMEOUT', { message });
}

export function throwUnreachableAsApiError(
  logPrefix: string,
  path: string,
  error: unknown,
  message: string,
): never {
  console.error(`[${logPrefix}] unreachable API for ${path}:`, error);
  throw new APIError('SERVICE_UNAVAILABLE', { message });
}

export function throwForNonOkResponse(
  response: Response,
  parsed: unknown,
  rawText: string,
): never {
  const errorBody =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { message: rawText || response.statusText || 'Request failed' };
  throw new APIError(toApiStatus(response.status), errorBody);
}
