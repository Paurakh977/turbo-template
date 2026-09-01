import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load the isolated E2E environment. Located at the repo root so it can also be
// consumed by docker compose (--env-file .env.e2e) and the seed/cleanup scripts.
const envPath = fileURLToPath(new URL('../../../../.env.e2e', import.meta.url));
loadEnv({ path: envPath });

const num = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const E2E = {
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost:8443',
  appURL: process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:8443',
  apiURL: process.env.BETTER_AUTH_URL ?? 'https://localhost:8443',
  databaseURL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://e2e_user:e2e_password@localhost:5434/e2e_db?schema=public',
  redisURL:
    process.env.E2E_REDIS_URL ??
    'redis://:e2e_redis_password@localhost:6381',
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'https://localhost:8443')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'superadmin@test.local',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'e2e-SuperAdmin-Pass-123',
    name: process.env.SEED_ADMIN_NAME ?? 'E2E Super Admin',
  },
  rateLimit: {
    window: num(process.env.RATE_LIMIT_WINDOW, 5),
    max: num(process.env.RATE_LIMIT_MAX, 1000),
  },
  authCookieName: '__Secure-better-auth.session_token',
  testUserDomain: 'test.local',
} as const;

export type E2EConfig = typeof E2E;
