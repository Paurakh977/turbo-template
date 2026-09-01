export type E2ERole = 'user' | 'operator' | 'admin' | 'superAdmin';

export interface E2EUser {
  key: E2ERole;
  email: string;
  password: string;
  name: string;
  role: string;
}

/**
 * Deterministic, never-random E2E accounts. These are seeded once by
 * scripts/seed.ts and reused across every test via saved storage states.
 * Passwords satisfy the server-side password policy (>=8 chars, mixed case,
 * digit, symbol).
 */
export const E2E_USERS: Record<E2ERole, E2EUser> = {
  user: {
    key: 'user',
    email: 'user@test.local',
    password: 'e2e-User-Pass-123',
    name: 'E2E User',
    role: 'user',
  },
  operator: {
    key: 'operator',
    email: 'operator@test.local',
    password: 'e2e-Operator-Pass-123',
    name: 'E2E Operator',
    role: 'operator',
  },
  admin: {
    key: 'admin',
    email: 'admin@test.local',
    password: 'e2e-Admin-Pass-123',
    name: 'E2E Admin',
    role: 'admin',
  },
  superAdmin: {
    key: 'superAdmin',
    email: 'superadmin@test.local',
    password: 'e2e-SuperAdmin-Pass-123',
    name: 'E2E Super Admin',
    role: 'superAdmin',
  },
};

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const STORAGE_STATE_DIR = fileURLToPath(
  new URL('../.auth', import.meta.url),
);
export const STORAGE_STATE_FILE = (role: E2ERole): string =>
  join(STORAGE_STATE_DIR, `${role.toLowerCase()}.json`);
