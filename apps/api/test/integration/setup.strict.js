/**
 * Strict setup for integration tests: email verification is ENFORCED.
 * Differs from setup.ts by setting RESEND_API_KEY (so canSendEmail: true =>
 * requireEmailVerification: true) and NOT setting EMAIL_VERIFICATION=relaxed.
 * Loaded as CommonJS so `process.env` is set before the spec imports modules.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.PORT = process.env.PORT || '3001';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5433/test_db?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
process.env.REDIS_PREFIX = process.env.REDIS_PREFIX || 'int-test:';
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3001';
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || 'test-secret-minimum-32-characters-long!!';
process.env.APP_NAME = process.env.APP_NAME || 'Integration Test';
process.env.EMAIL_FROM = process.env.EMAIL_FROM || 'test@example.com';
// Do NOT relax email verification.
process.env.TRUSTED_ORIGINS = process.env.TRUSTED_ORIGINS || 'http://localhost:3000';

// A dummy key so the app believes it can send email (enforces verification).
process.env.RESEND_API_KEY = 're_strict_test_dummy_key_000000000000000000';
process.env.DEV_EMAIL_OVERRIDE = '';

process.env.RATE_LIMIT_MAX = '9999';
process.env.RATE_LIMIT_WINDOW = '60';
