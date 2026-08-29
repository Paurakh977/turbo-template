import { db } from '@repo/database';

const TRUNCATE_ORDER = [
  'audit_log',
  'note',
  '"twoFactor"',
  '"rateLimit"',
  'session',
  'account',
  'verification',
  'jwks',
  '"user"',
] as const;

/**
 * Truncates all mutable tables with CASCADE.
 * Called in beforeEach of every integration test suite.
 */
export async function truncateAllTables() {
  for (const table of TRUNCATE_ORDER) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE`);
  }
}

/**
 * Quick health check — verifies the database connection is alive.
 */
export async function checkDatabaseConnection() {
  const result = await db.$queryRaw`SELECT 1 as ok`;
  return Array.isArray(result) && result.length > 1;
}
