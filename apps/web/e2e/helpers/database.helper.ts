import { Pool } from 'pg';
import { E2E } from '../config/playwright.env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: E2E.databaseURL });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Tables safe to wipe between individual tests (never the seeded users). */
export const VOLATILE_TABLES = [
  'note',
  'audit_log',
  'session',
  'verification',
  'rateLimit',
];

/** Full wipe used by global teardown (includes users). */
export const ALL_TABLES = [
  'note',
  'audit_log',
  'session',
  'verification',
  'rateLimit',
  'twoFactor',
  'account',
  'jwks',
  'user',
];

export async function truncateVolatile(): Promise<void> {
  const list = VOLATILE_TABLES.map((t) => `"${t}"`).join(', ');
  await getPool().query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export async function truncateAll(): Promise<void> {
  const list = ALL_TABLES.map((t) => `"${t}"`).join(', ');
  await getPool().query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

export async function countNotes(authorId?: string): Promise<number> {
  const { rows } = await getPool().query(
    authorId
      ? 'SELECT COUNT(*)::int AS c FROM "note" WHERE "authorId" = $1'
      : 'SELECT COUNT(*)::int AS c FROM "note"',
    authorId ? [authorId] : [],
  );
  return rows[0]?.c ?? 0;
}
