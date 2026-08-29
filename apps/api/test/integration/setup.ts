/**
 * Global setup for integration tests.
 * Sets env vars required by ConfigModule's Joi schema before any imports.
 * Must run BEFORE packages/auth/src/load-env.ts loads the root .env.
 */
process.env.NODE_ENV ??= 'test';
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??=
  'postgresql://test_user:test_password@localhost:5433/test_db?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.REDIS_PREFIX ??= 'int-test:';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001';
process.env.BETTER_AUTH_SECRET ??=
  'test-secret-minimum-32-characters-long!!';
process.env.APP_NAME ??= 'Integration Test';
process.env.EMAIL_FROM ??= 'test@example.com';
process.env.EMAIL_VERIFICATION ??= 'relaxed';
process.env.TRUSTED_ORIGINS ??= 'http://localhost:3000';

// Override root .env values: disable email provider so sign-up returns session
// cookies directly (requireEmailVerification: false when canSendEmail: false).
process.env.RESEND_API_KEY = '';
process.env.DEV_EMAIL_OVERRIDE = '';

// Set generous rate limits so integration tests don't get blocked.
// load-env.ts reads root .env which has RATE_LIMIT_MAX=100; override before auth loads.
process.env.RATE_LIMIT_MAX = '9999';
process.env.RATE_LIMIT_WINDOW = '60';

export {};
