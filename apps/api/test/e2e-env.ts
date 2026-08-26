/**
 * Minimal env for the supertest e2e boot. Values are placeholders - the suite
 * never touches real Postgres/Redis (see moduleNameMapper in jest-e2e.json),
 * but ConfigModule's Joi schema requires them to be present and well-formed.
 */
process.env.NODE_ENV ??= 'test';
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??=
  'postgresql://e2e:e2e@127.0.0.1:5432/e2e?schema=public';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET ??=
  'e2e-only-secret-0123456789abcdef0123456789abcdef';
process.env.APP_NAME ??= 'Ozon E2E';
