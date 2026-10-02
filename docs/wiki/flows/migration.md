---
title: "Flow: Migration Fragment to Deploy"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/database-prisma.md"]
sources: ["packages/database/prisma/models/note.prisma", "packages/database/prisma/migrations/20260927080215_init/migration.sql", "packages/database/prisma.config.ts", "packages/database/src/client.ts", "apps/migrate/Dockerfile", "docker-compose.yml"]
depends_on: ["invariants/04-database-connections.md"]
guards: ["apps/api/test/integration/modules/database-failure.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Migration Fragment to Deploy
> Up: ../00-INDEX.md | Depends on: INV-004
## Purpose
- Fact: Tracks schema fragment through migrate image with DIRECT_URL to deploy versus pooler runtime path.
- Interpretation: Poolers break session-level locks; direct connection is mandatory for deploy correctness.
- Recommendation: Never point migrations at pooler URL; keep Turbo passing DIRECT_URL for db tasks.
## Diagram
```text
models/*.prisma fragment -> migration.sql -> prisma.config(snapshot DIRECT_URL first)
  -> migrate image(Dockerfile trim) -> DIRECT_URL postgres:5432 deploy+locks
  -> app DATABASE_URL pgbouncer:6432 transaction mode -> client.ts pool
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Fragment | packages/database/prisma/models/note.prisma:Note | fields -> cuid+author FK+index | Missing composite index regresses list pagination |
| 1 | SQL | packages/database/prisma/migrations/20260927080215_init/migration.sql:migration | fragment -> DDL | Applied migrations never edited; follow-up migration only |
| 2 | Config | packages/database/prisma.config.ts:datasource | env -> DIRECT_URL else DATABASE_URL | Snapshot before dotenv; prod requires DIRECT_URL fail-fast |
| 3 | Isolated image | apps/migrate/Dockerfile:migrate | schema+migrations -> deploy run | Trim image ~150MB; boot gate blocks api until migrate done |
| 4 | Compose wire | docker-compose.yml:DIRECT_URL | migrate -> postgres 5432 direct | Pgbouncer 6432 never used for migrate; advisory locks need session |
| 5 | Runtime pool | packages/database/src/client.ts:PrismaClient | DATABASE_URL -> PgBouncer pool | Pool math workers x POOL_MAX <= MAX_CLIENT; timeouts 5s/30s |
| 6 | Client flags | packages/database/src/client.ts:pgbouncer | client -> pgbouncer=true batch | Transaction mode safe; disposeExternalPool on SIGTERM clean |
| 7 | Verify | apps/api/test/integration/modules/database-failure.integration.spec.ts:pool | deploy -> integration proof | Migrate-test plus tmpfs profiles prove isolation |
## Files
- Fact: `packages/database/prisma/models/*` fragments plus `schema.prisma` generator plus datasource blocks.
- Fact: `packages/database/prisma.config.ts:29-41` prefers DIRECT_URL, falls back DATABASE_URL locally.
- Fact: `apps/migrate/Dockerfile` minimal Node plus prisma schema plus `migrate deploy` once then exit.
- Fact: `packages/database/src/client.ts:38-69` pool tuning plus `disposeExternalPool` plus SIGTERM hook.
## Failure branches
- Fact: Pooler migrate -> lock loss plus deploy deadlock; guard rejects pooler URL for migrate tasks.
- Fact: Missing DIRECT_URL in prod -> throw fail-fast; local dev falls back to DATABASE_URL convenience.
- Fact: Wrong server target -> snapshot-before-dotenv prevents localhost backfill hitting test containers.
- Fact: Pool exhaustion -> connectionTimeout 5s throws; scale via WORKERS versus POOL_MAX math not blind raise.
## Security + observability implications
- Fact: Migrate image holds DIRECT_URL secret; never baked into web image or browser bundle.
- Fact: Pool gauges plus `recordHttpError` surface contention; ELU plus delay guide worker scaling.
- Interpretation: Raising pool without PG max_connections headroom just moves queue to Postgres.
- Fact: Truncate order in seed/scripts respects FK cascade; notes purge keeps outbox tiny without touching PENDING.
## Linked invariants
- Recommendation: Enforced by [INV-004 Database Connections](../invariants/04-database-connections.md) plus ADR-0008 isolated image.
- Recommendation: Related pool runbook in `database-package` plus compose profiles in `docker-environments`.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T3,T7; subsystems `database-prisma` plus `database-package`.
- Fact: Turbo `passThroughEnv` carries DIRECT_URL for all db tasks; missing pass-through breaks CI deploy only.
- Fact: Studio and admin ops also prefer DIRECT_URL for dedicated-session guarantees outside request path.
- Fact: New model checklist requires fragment then migrate then generate then pool math then authz audit check.
