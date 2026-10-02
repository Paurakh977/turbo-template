---
title: "Pooler for Runtime Direct for Migrations"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/database-prisma.md"]
sources: ["packages/database/prisma.config.ts", "packages/database/src/client.ts", "pgbouncer/pgbouncer.ini", "docker-compose.yml", "apps/api/src/cluster.ts", "apps/migrate/Dockerfile"]
depends_on: ["decisions/ADR-0008-isolated-migrate-image.md", "flows/migration.md"]
guards: ["apps/api/test/integration/modules/database-failure.integration.spec.ts", "apps/api/test/integration/modules/performance.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-004 Pooler for Runtime Direct for Migrations
> Up: ../00-INDEX.md
**ID:** INV-004
## Invariant
- Fact: Runtime MUST use DATABASE_URL pooler `pgbouncer:6432?pgbouncer=true`; migrate plus studio plus seed MUST use DIRECT_URL direct `postgres:5432` with isolated image.
## Why
- Fact: Pooled migrate breaks advisory locks and SET ROLE on shared sessions, stalls deploy, and boots app on old schema (FINAL-07 Critical-04 plus Medium-02).
## Code
- Fact: `packages/database/prisma.config.ts` snapshot-before-dotenv prefers DIRECT_URL, prod fail-fast if unset; `packages/database/src/client.ts` Prisma pool max 10 plus 5s plus 30s plus `disposeExternalPool`.
- Fact: `pgbouncer/pgbouncer.ini` default 25 plus reserve 5 below Postgres max 200; `docker-compose.yml:283-293` injects DIRECT_URL to migrate and pooler URL to api.
- Fact: `apps/api/src/cluster.ts:21-52` two independent budgets workers-times-POOL_MAX below client max and server default-plus-reserve below Postgres max; cap workers at 8.
### Folded INV-015 migrate-isolation plus snapshot-plus-fail-fast
- Fact: `apps/migrate/Dockerfile` owns trimmed workspace plus lockfile plus boot gate; batch `$transaction` in `apps/api/src/common/audit-queue.service.ts:293-297` stays PgBouncer-safe.
- Fact: Turbo passes DIRECT_URL for db tasks; app DATABASE_URL carries `pgbouncer=true` so interactive tx stays out of batch path.
## Consequences
- Fact: Deploys migrate on dedicated session then app boots on new schema; worker scale stays within pooler and Postgres budgets without wait timeouts.
## Naive failure mode
- Interpretation: Reusing app URL for `db:migrate:deploy` for convenience routes DDL through pooler and fails locks under load.
- Interpretation: Raising API_WORKERS without pool math or dropping PrismaPg adapter storms PgBouncer client slots.
## Guards-tests
- Fact: Run `database-failure` plus `performance` plus prisma integration; verify `migrate-test` profile uses DIRECT_URL and pool gauges stay bounded.
## Related ADRs
- Recommendation: See [ADR-0008 Isolated Migrate](../decisions/ADR-0008-isolated-migrate-image.md) for trim plus DIRECT_URL bypass rationale.
## Related flows-subsystems
- Recommendation: Enforced in [migration](../flows/migration.md); owned by [database-prisma](../subsystems/database-prisma.md) plus database-package.
- Fact: For audit outbox batch safety see [05-audit-planes.md](05-audit-planes.md) INV-005 pointer only; this file owns only connection routing plus pool math.
