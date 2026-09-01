import { E2E } from '../config/playwright.env';

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax' | 'Strict' | 'None';
  }>;
  origins: never[];
}

/**
 * Build a Playwright storage-state object from a raw session cookie value.
 * The cookie is written with domain 'localhost' and path '/' so both browser
 * contexts and APIRequestContext (request.newContext) can validate and use it.
 */
export function buildStorageState(cookieValue: string): StorageState {
  return {
    cookies: [
      {
        name: E2E.authCookieName,
        value: cookieValue,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  };
}

