import { test as base } from './redis.fixture';
import { ApiClient, cookieFromStorageState } from '../helpers/api.helper';
import { E2E_USERS } from '../config/users';

type AuthFixture = {
  /** Raw session cookie for the superadmin role (use for API-level calls). */
  cookie: string;
  /** API client authenticated as superadmin, hitting the real API via nginx. */
  api: ApiClient;
  users: typeof E2E_USERS;
};

export const test = base.extend<AuthFixture>({
  cookie: async ({}, use) => {
    await use(cookieFromStorageState('superadmin'));
  },
  api: async ({ cookie }, use) => {
    const client = await ApiClient.create(cookie);
    await use(client);
    await client.close();
  },
  users: async ({}, use) => {
    await use(E2E_USERS);
  },
});

export const expect = test.expect;
