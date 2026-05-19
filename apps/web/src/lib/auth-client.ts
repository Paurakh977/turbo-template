'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { adminClient } from 'better-auth/client/plugins';
import { AUTH_BASE_PATH, ADMIN_PLUGIN_ROLES, ac } from '@repo/auth/permissions';

type AuthClientError = { error?: { status?: number } };

let lastRateLimitWarnAt = 0;
function notifyRateLimit() {
  const now = Date.now();
  if (now - lastRateLimitWarnAt < 5000) return;
  lastRateLimitWarnAt = now;
  console.warn('Rate limited! Too many requests.');
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
      onTwoFactorRedirect() {
        window.location.href = '/auth/two-factor';
      },
    }),
    adminClient({
      ac,
      roles: ADMIN_PLUGIN_ROLES,
    }),
  ],
  fetchOptions: {
    credentials: 'include',
    onError(e: AuthClientError) {
      if (e.error?.status === 429) notifyRateLimit();
    },
  },
});

export const authClient: typeof client = client;
export type Session = typeof authClient.$Infer.Session;
