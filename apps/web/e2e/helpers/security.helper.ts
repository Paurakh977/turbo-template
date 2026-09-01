import { type APIResponse, type Response } from '@playwright/test';

export interface SecurityHeaders {
  'content-security-policy'?: string | null;
  'strict-transport-security'?: string | null;
  'x-frame-options'?: string | null;
  'x-content-type-options'?: string | null;
  'referrer-policy'?: string | null;
  'x-xss-protection'?: string | null;
}

export function headersToMap(res: APIResponse | Response): Record<string, string> {
  const out: Record<string, string> = {};
  const arr =
    'headers' in res && typeof (res as APIResponse).headers === 'function'
      ? (res as APIResponse).headersArray()
      : Object.entries((res as Response).headers() ?? {});
  if (Array.isArray(arr)) {
    (arr as Array<{ name: string; value: string }>).forEach((h) => {
      out[h.name.toLowerCase()] = h.value;
    });
  }
  return out;
}

export const EXPECTED_SECURITY_HEADERS: Array<keyof SecurityHeaders> = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
];

export function assertSecurityHeaders(
  headers: Record<string, string>,
): void {
  for (const key of EXPECTED_SECURITY_HEADERS) {
    if (!headers[key]) {
      throw new Error(`Missing security header: ${key}`);
    }
  }
  if (!/frame-ancestors\s+'?none'?/i.test(headers['content-security-policy'] ?? '')) {
    throw new Error('CSP must set frame-ancestors none');
  }
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
}

export function parseSetCookie(header: string): CookieAttributes {
  const parts = header.split(';').map((p) => p.trim());
  const firstPart = parts[0] ?? '';
  const [name = '', ...rest] = firstPart.split('=');
  const attrs: CookieAttributes = { name, value: rest.join('=') };
  for (const part of parts.slice(1)) {
    const idx = part.indexOf('=');
    const k = idx >= 0 ? part.slice(0, idx) : part;
    const v = idx >= 0 ? part.slice(idx + 1) : undefined;
    const key = k.toLowerCase();
    if (key === 'path') attrs.path = v;
    else if (key === 'httponly') attrs.httpOnly = true;
    else if (key === 'secure') attrs.secure = true;
    else if (key === 'samesite') attrs.sameSite = (v ?? '').toLowerCase();
  }
  return attrs;
}

export function assertSessionCookieSecure(attrs: CookieAttributes): void {
  if (!attrs.httpOnly) throw new Error('Session cookie must be HttpOnly');
  if (!attrs.secure) throw new Error('Session cookie must be Secure');
  if (attrs.sameSite && attrs.sameSite !== 'lax' && attrs.sameSite !== 'strict') {
    throw new Error(`Session cookie SameSite unexpected: ${attrs.sameSite}`);
  }
  if (attrs.path && attrs.path !== '/') {
    throw new Error(`Session cookie path must be /, got ${attrs.path}`);
  }
}
