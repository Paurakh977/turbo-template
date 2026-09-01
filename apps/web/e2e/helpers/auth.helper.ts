import { E2E } from '../config/playwright.env';
import { query } from './database.helper';
import { flushRateLimits, getRedis } from './redis.helper';

export interface AuthResult {
  status: number;
  body: any;
  headers: Headers;
  error: any;
  data: any;
}

async function authFetch(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Promise<AuthResult> {
  let cookieHeader = cookie;
  if (cookie && !cookie.includes('=')) {
    cookieHeader = `${E2E.authCookieName}=${cookie}`;
  }
  const res = await fetch(`${E2E.baseURL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: E2E.appURL,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return {
    status: res.status,
    body: json,
    headers: res.headers,
    error: json?.error ?? null,
    data: json?.data ?? null,
  };
}

export function extractCookie(headers: Headers): string {
  const rawHeaders: string[] =
    typeof (headers as any).getSetCookie === 'function'
      ? (headers as any).getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie')!]
        : [];
  for (const setCookie of rawHeaders) {
    const match = setCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
    if (match) {
      // Better Auth session cookie contains an unencoded dot (`token.sig`). Keep it
      // exactly as sent; decoding it makes the session cookie invalid.
      return match[1] ?? '';
    }
  }
  return '';
}

export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  let result = await authFetch('/api/auth/sign-up/email', 'POST', {
    name,
    email,
    password,
    callbackURL: '/dashboard',
  });
  for (let attempt = 0; attempt < 3 && result.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    result = await authFetch('/api/auth/sign-up/email', 'POST', {
      name,
      email,
      password,
      callbackURL: '/dashboard',
    });
  }
  return result;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ result: AuthResult; cookie: string }> {
  let result = await authFetch('/api/auth/sign-in/email', 'POST', {
    email,
    password,
    callbackURL: '/dashboard',
  });
  for (let attempt = 0; attempt < 3 && result.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    result = await authFetch('/api/auth/sign-in/email', 'POST', {
      email,
      password,
      callbackURL: '/dashboard',
    });
  }
  return { result, cookie: extractCookie(result.headers) };
}

export async function signOut(cookie: string): Promise<AuthResult> {
  return authFetch('/api/auth/sign-out', 'POST', {}, cookie);
}

export async function getSession(cookie: string): Promise<AuthResult> {
  return authFetch('/api/auth/get-session', 'GET', undefined, cookie);
}

export async function requestPasswordReset(email: string): Promise<{
  token: string | null;
  error: any;
}> {
  let res = await authFetch('/api/auth/request-password-reset', 'POST', {
    email,
    redirectTo: `${E2E.appURL}/auth/reset-password`,
  });
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    res = await authFetch('/api/auth/request-password-reset', 'POST', {
      email,
      redirectTo: `${E2E.appURL}/auth/reset-password`,
    });
  }
  // Better Auth stores reset tokens in Redis under key:
  //   "verification:reset-password:{TOKEN}"
  // The actual token needed for the /reset-password API is the suffix after the last ':'.
  let token: string | null = res.body?.token ?? res.body?.data?.token ?? null;
  if (!token) {
    try {
      const redis = getRedis();
      // Give the API a moment to write to Redis
      await new Promise((r) => setTimeout(r, 300));
      const keys = await redis.keys('verification:reset-password:*');
      if (keys.length > 0) {
        // Pick the newest key (last in the list)
        const latestKey = keys[keys.length - 1]!;
        const parts = latestKey.split(':');
        token = parts[parts.length - 1] ?? null;
      }
    } catch {
      /* Redis unavailable */
    }
  }
  // Fallback: DB verification table
  if (!token) {
    const rows = await query<{ value: string; identifier: string }>(
      `SELECT value, identifier FROM "verification" WHERE identifier LIKE '%reset-password%' ORDER BY id DESC LIMIT 1`,
    );
    if (rows.length > 0) {
      const identifier = rows[0]?.identifier ?? '';
      const parts = identifier.split(':');
      token = parts[parts.length - 1] ?? rows[0]?.value ?? null;
    }
  }
  return { token, error: res.error };
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ error: any }> {
  let res = await authFetch('/api/auth/reset-password', 'POST', {
    newPassword,
    token,
  });
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    res = await authFetch('/api/auth/reset-password', 'POST', {
      newPassword,
      token,
    });
  }
  return { error: res.error };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  cookie: string,
): Promise<{ error: any }> {
  let res = await authFetch(
    '/api/auth/change-password',
    'POST',
    { currentPassword, newPassword },
    cookie,
  );
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    res = await authFetch(
      '/api/auth/change-password',
      'POST',
      { currentPassword, newPassword },
      cookie,
    );
  }
  return { error: res.error };
}

export async function enableTwoFactor(
  email: string,
  password: string,
): Promise<{ backupCodes: string[]; totpURI: string; cookie: string; error: any }> {
  const { cookie } = await signIn(email, password);
  let res = await authFetch(
    '/api/auth/two-factor/enable',
    'POST',
    { password },
    cookie,
  );
  for (let attempt = 0; attempt < 3 && res.status === 429; attempt++) {
    await flushRateLimits();
    await new Promise((r) => setTimeout(r, 100));
    res = await authFetch(
      '/api/auth/two-factor/enable',
      'POST',
      { password },
      cookie,
    );
  }
  let backupCodes: string[] = res.body?.backupCodes ?? res.body?.data?.backupCodes ?? res.data?.backupCodes ?? [];
  let totpURI: string = res.body?.totpURI ?? res.body?.data?.totpURI ?? res.data?.totpURI ?? '';
  if (backupCodes.length === 0 || !totpURI) {
    const rows = await query<{ backupCodes: string; secret: string }>(
      `SELECT "backupCodes", secret FROM "twoFactor" tf JOIN "user" u ON tf."userId" = u.id WHERE u.email = $1 LIMIT 1`,
      [email],
    );
    if (rows.length > 0) {
      if (backupCodes.length === 0 && rows[0]?.backupCodes) {
        try {
          const parsed = JSON.parse(rows[0].backupCodes);
          backupCodes = Array.isArray(parsed) ? parsed : [rows[0].backupCodes];
        } catch {
          backupCodes = rows[0].backupCodes.split(',').map((s) => s.trim());
        }
      }
      if (!totpURI && rows[0]?.secret) {
        totpURI = `otpauth://totp/Ozon:${email}?secret=${rows[0].secret}&issuer=Ozon`;
      }
    }
  }
  return { backupCodes, totpURI, cookie, error: res.error };
}

export async function verifyTotp(
  code: string,
  trustDevice: boolean,
  cookie?: string,
): Promise<{ error: any }> {
  const res = await authFetch(
    '/api/auth/two-factor/verify-totp',
    'POST',
    { code, trustDevice },
    cookie,
  );
  return { error: res.error };
}

export async function getLatestVerification(
  identifier: string,
): Promise<{ token: string | null; expiresAt: Date | null; error: any }> {
  const res = await authFetch(
    `/api/auth/request-password-reset`,
    'POST',
    { email: identifier },
  );
  const token = res.body?.token ?? res.body?.data?.token ?? null;
  return { token, expiresAt: null, error: res.error };
}
