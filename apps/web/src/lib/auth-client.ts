'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { adminClient } from 'better-auth/client/plugins';
import { AUTH_BASE_PATH, ADMIN_PLUGIN_ROLES, ac } from '@repo/auth/permissions';
import {
  AUTH_RATE_LIMIT_EVENT,
  AUTH_RATE_LIMIT_MESSAGE,
  type AuthRateLimitDetail,
} from './auth-rate-limit-event';

/**
 * The onError context from @better-fetch/fetch includes:
 *   { response: Response, request: { url, method, headers, … }, error }
 */
type RateLimitErrorContext = {
  response?: {
    status?: number;
    headers?: { get: (key: string) => string | null };
  };
  request?: { url?: string | { href?: string }; method?: string };
};
export const TWO_FACTOR_CHALLENGE_STORAGE_KEY = 'ba:two-factor-challenge';

// ── Endpoint classification ──────────────────────────────────────────────
//
// Passive endpoints are read-only and polled automatically (useSession,
// listAccounts, etc.). They should NEVER show a global toast — per-page
// inline state handles 429 gracefully when needed.
//
// Destructive endpoints are mutations where the user expects visible
// feedback that their action was blocked (delete, ban, role change).
//
// Auth-challenge endpoints already have per-page inline error handling
// (sign-in, sign-up, 2FA, password reset, email verification).
//
const PASSIVE_ENDPOINT_PATTERNS = [
  '/get-session',
  '/list-accounts',
  '/admin/list-users',
  '/admin/list-user-sessions',
];

const AUTH_CHALLENGE_ENDPOINT_PATTERNS = [
  '/sign-in/',
  '/sign-up/',
  '/reset-password',
  '/request-password-reset',
  '/send-verification-email',
  '/verify-email',
  '/two-factor/',
  '/change-password',
  '/change-email',
];

// Admin mutation endpoints — AdminUserTable and other per-call handlers
// already show their own toasts via handleError()/pushToast(). The global
// onError must NOT fire another toast to avoid double-toast.
const HANDLED_PER_CALL_ENDPOINT_PATTERNS = [
  '/admin/set-role',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/revoke-user-sessions',
  '/admin/revoke-user-session',
  '/admin/impersonate-user',
  '/admin/remove-user',
  '/admin/stop-impersonating',
  '/admin/create-user',
  '/admin/set-user-password',
];

type EndpointCategory =
  | 'passive'
  | 'auth-challenge'
  | 'handled-per-call'
  | 'destructive';

function classifyEndpoint(url: string): EndpointCategory {
  try {
    const pathname = typeof url === 'string' ? new URL(url).pathname : url;
    if (PASSIVE_ENDPOINT_PATTERNS.some((p) => pathname.includes(p))) {
      return 'passive';
    }
    if (HANDLED_PER_CALL_ENDPOINT_PATTERNS.some((p) => pathname.includes(p))) {
      return 'handled-per-call';
    }
    if (AUTH_CHALLENGE_ENDPOINT_PATTERNS.some((p) => pathname.includes(p))) {
      return 'auth-challenge';
    }
  } catch {
    // If URL parsing fails, treat as destructive (show toast — safer default)
  }
  return 'destructive';
}

// ── Rate-limit notification (throttled) ──────────────────────────────────

let lastRateLimitWarnAt = 0;
function notifyRateLimit(message?: string, retryAfter?: number) {
  const now = Date.now();
  if (now - lastRateLimitWarnAt < 5000) return;
  lastRateLimitWarnAt = now;
  const detail: AuthRateLimitDetail = {
    message: message ?? AUTH_RATE_LIMIT_MESSAGE,
  };
  if (retryAfter !== undefined) {
    detail.retryAfter = retryAfter;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_RATE_LIMIT_EVENT, { detail }),
    );
    return;
  }
  console.warn(
    '[AuthClient] Rate limited:',
    message ?? AUTH_RATE_LIMIT_MESSAGE,
  );
}

/**
 * Parse the HTTP `Retry-After` header into whole seconds.
 * Accepts the delta-seconds form (e.g. "10", as nginx sends); HTTP-date
 * strings fall back to undefined so callers use their default message.
 *
 * The param is a structural subset of `Headers` because Better Auth's
 * rate-limit hook exposes a minimal headers-like object, not a real
 * `Headers` instance (a real one still satisfies this shape).
 */
function parseRetryAfter(
  headers?: { get: (key: string) => string | null },
): number | undefined {
  if (!headers) return undefined;
  const raw = headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

function resolveRequestUrl(context: RateLimitErrorContext): string {
  const req = context.request;
  if (!req?.url) return '';
  if (typeof req.url === 'string') return req.url;
  if (typeof req.url === 'object' && 'href' in req.url)
    return req.url.href ?? '';
  return '';
}

// ── Auth client instance ─────────────────────────────────────────────────

// Server-side fallback chain: NEXT_PUBLIC_APP_URL is the public origin the
// API's trustedOrigins already accepts (BETTER_AUTH_URL is NOT injected into
// this container under Architecture B). Nothing fetches through authClient
// during SSR today; the fallback only exists so a future accidental
// server-side call hits a real origin instead of localhost:3000.
const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL ||
      process.env.BETTER_AUTH_URL ||
      'http://localhost:3000';

const client = createAuthClient({
  baseURL,
  basePath: AUTH_BASE_PATH,
  sessionOptions: {
    refetchOnWindowFocus: true,
  },
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect({ twoFactorMethods }) {
        try {
          window.sessionStorage.setItem(
            TWO_FACTOR_CHALLENGE_STORAGE_KEY,
            JSON.stringify({
              methods: Array.isArray(twoFactorMethods) ? twoFactorMethods : [],
              issuedAt: Date.now(),
            }),
          );
        } catch {
          // no-op
        }

        const params = new URLSearchParams();
        if (Array.isArray(twoFactorMethods) && twoFactorMethods.length > 0) {
          params.set('methods', twoFactorMethods.join(','));
        }
        const query = params.toString();
        window.location.href = query
          ? `/auth/two-factor?${query}`
          : '/auth/two-factor';
      },
    }),
    adminClient({
      ac,
      roles: ADMIN_PLUGIN_ROLES,
    }),
  ],
  fetchOptions: {
    credentials: 'include',
    onError(context: RateLimitErrorContext) {
      if (context.response?.status !== 429) return;

      const url = resolveRequestUrl(context);
      const category = classifyEndpoint(url);

      switch (category) {
        case 'passive': {
          // Silent degradation — per-page inline state handles 429.
          // The useSession hook exposes error.status for dashboard, etc.
          console.warn(
            '[AuthClient] Passive endpoint rate-limited (silent):',
            url,
          );
          break;
        }
        case 'auth-challenge': {
          // Per-page inline errors already show the rate-limit message
          // (auth/page.tsx, forgot-password/page.tsx, two-factor/page.tsx, etc.)
          // No global toast needed — it would duplicate the inline error.
          console.warn(
            '[AuthClient] Auth-challenge endpoint rate-limited (inline):',
            url,
          );
          break;
        }
        case 'handled-per-call': {
          // Per-call error handlers (AdminUserTable's handleError / pushToast)
          // already show a toast for these endpoints. The global onError must
          // not fire another one to avoid the double-toast bug.
          console.warn(
            '[AuthClient] Admin mutation rate-limited (suppressed — per-call handler):',
            url,
          );
          break;
        }
        case 'destructive': {
          // No per-page handler — user needs a toast to know the action
          // was blocked (delete-user, sign-out, etc.)
          const retryAfter = parseRetryAfter(context.response?.headers);
          const message = retryAfter
            ? `Too many requests. Please try again in ${retryAfter}s.`
            : AUTH_RATE_LIMIT_MESSAGE;
          notifyRateLimit(message, retryAfter);
          break;
        }
      }
    },
  },
});

export const authClient: typeof client = client;
export type Session = typeof authClient.$Infer.Session;

// ── Typed account helpers ────────────────────────────────────────────────
// The client proxy method `authClient.listAccounts()` is inferred from the
// `/list-accounts` endpoint. These wrappers normalize the response into a
// typed, minimal shape so call sites never need unsafe casts.

export type LinkedAccount = {
  providerId: string;
  accountId: string;
};

export async function listLinkedAccounts(): Promise<LinkedAccount[]> {
  const res = await authClient.listAccounts();
  if (!res || res.error || !Array.isArray(res.data)) return [];
  return res.data
    .filter(
      (account) =>
        Boolean(account) &&
        typeof account.providerId === 'string' &&
        typeof account.accountId === 'string',
    )
    .map((account) => ({
      providerId: account.providerId,
      accountId: account.accountId,
    }));
}

export async function getHasCredentialAccount(): Promise<boolean> {
  const accounts = await listLinkedAccounts();
  return accounts.some((a) => a.providerId === 'credential');
}
