'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { adminClient } from 'better-auth/client/plugins';
import { AUTH_BASE_PATH, ADMIN_PLUGIN_ROLES, ac } from '@repo/auth/permissions';
import {
  AUTH_RATE_LIMIT_EVENT,
  AUTH_RATE_LIMIT_MESSAGE,
} from './auth-rate-limit-event';

type AuthFetchErrorContext = {
  response?: {
    status?: number;
    headers?: { get: (key: string) => string | null };
  };
};
export const TWO_FACTOR_CHALLENGE_STORAGE_KEY = 'ba:two-factor-challenge';

let lastRateLimitWarnAt = 0;
function notifyRateLimit() {
  const now = Date.now();
  if (now - lastRateLimitWarnAt < 5000) return;
  lastRateLimitWarnAt = now;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AUTH_RATE_LIMIT_EVENT, {
        detail: { message: AUTH_RATE_LIMIT_MESSAGE },
      }),
    );
    return;
  }
  console.warn(AUTH_RATE_LIMIT_MESSAGE);
}

const baseURL =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.BETTER_AUTH_URL || 'http://localhost:3000';

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
    onError(context: AuthFetchErrorContext) {
      if (context.response?.status === 429) notifyRateLimit();
    },
  },
});

export const authClient: typeof client = client;
export type Session = typeof authClient.$Infer.Session;
