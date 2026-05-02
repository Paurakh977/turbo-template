'use client';

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

function resolveAuthBaseURL() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    return undefined;
  }

  if (/^https?:\/\//.test(apiUrl)) {
    return apiUrl.replace(/\/api\/?$/, '');
  }

  return undefined;
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseURL(),
  basePath: '/api/auth',
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/auth/two-factor';
      },
    }),
  ],
});

export type Session = typeof authClient.$Infer.Session;
