import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function parsePositiveInt(
  name: string,
  fallback: number,
  { min = 0 }: { min?: number } = {},
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${name}: "${raw}" must be a whole number.`);
  }
  const value = Number(raw);
  if (value < min) {
    throw new Error(`Invalid ${name}: "${raw}" must be >= ${min}.`);
  }
  return value;
}

function getPool(): Pool {
  globalForPrisma.pgPool ??= new Pool({
    connectionString: process.env.DATABASE_URL ?? '',
    // Validated: bare Number() turned "10x" into a silently-truncated pool
    // size and "" into NaN. Pool max of 0 would mean a pool that can never
    // acquire a client (hangs forever), hence min 1 here.
    max: parsePositiveInt('DATABASE_POOL_MAX', 10, { min: 1 }),
    connectionTimeoutMillis: parsePositiveInt(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      5_000,
    ),
    idleTimeoutMillis: parsePositiveInt('DATABASE_IDLE_TIMEOUT_MS', 30_000),
  });

  return globalForPrisma.pgPool;
}

function getClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(getPool(), {
      // $disconnect() must end the pg pool, not just detach from it - the
      // shutdown hook in apps/api relies on this for graceful SIGTERM
      // draining. The pool is owned exclusively by this client singleton.
      disposeExternalPool: true,
    }),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });
}

export const db = globalForPrisma.prisma ?? getClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
