import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

// Load .env from monorepo root reliably regardless of process.cwd()
const __dirname = dirname(fileURLToPath(import.meta.url));
// Snapshot container-injected connection strings BEFORE dotenv
// loads the mounted root .env. dotenv never overrides existing vars, but it
// DOES backfill unset ones (notably DIRECT_URL in test/e2e containers that
// only set DATABASE_URL) — and the datasource below prefers DIRECT_URL, so
// without this snapshot migrations silently targeted localhost.
const injectedDirectUrl = process.env.DIRECT_URL;
const injectedDatabaseUrl = process.env.DATABASE_URL;
config({ path: resolve(__dirname, '../../.env') });
config({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: 'prisma/',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed.ts',
    // Migrations MUST run against the direct PostgreSQL connection
    // (not through PgBouncer) because `prisma migrate deploy` uses advisory
    // locks and SET ROLE that require a dedicated session-level connection.
    // DIRECT_URL bypasses PgBouncer → postgres:5432.
    // Falls back to DATABASE_URL for local dev where DIRECT_URL is unset.
  },
  datasource: {
    // DIRECT_URL is required for migrate/admin operations (dedicated
    // session for advisory locks + SET ROLE). The DATABASE_URL fallback
    // exists only for local `db:generate`/`db:push` convenience; Turbo now
    // passes DIRECT_URL through for all db:* tasks (turbo.json), and
    // production compose injects it explicitly. If DIRECT_URL is unset in
    // production, fail fast here instead of silently using the pooler.
    url:
      injectedDirectUrl ||
      injectedDatabaseUrl ||
      process.env.DIRECT_URL ||
      (process.env.NODE_ENV === 'production'
        ? env('DIRECT_URL')
        : env('DATABASE_URL')),
  },
});
