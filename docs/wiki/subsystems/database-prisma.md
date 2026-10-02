---
title: "Subsystem: Database Prisma (Schema, Migrations, PgBouncer Paths)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/database-prisma.md"]
sources: ["packages/database/prisma/models/note.prisma", "packages/database/prisma/models/auditLog.prisma", "packages/database/prisma/models/auditOutbox.prisma", "packages/database/prisma/models/betterAuth.prisma", "packages/database/prisma/migrations/20260927080215_init/migration.sql", "packages/database/prisma.config.ts", "packages/database/src/client.ts", "pgbouncer/pgbouncer.ini"]
depends_on: ["invariants/04-database-connections.md"]
guards: ["packages/database/test/integration/prisma.integration.spec.ts", "apps/api/test/integration/modules/notes-rbac.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Database Prisma (Schema, Migrations, PgBouncer Paths)
> Up: ../00-INDEX.md | Depends on: INV-04 (database-connections). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `packages/database/prisma/models/` fragments plus `packages/database/prisma.config.ts` (44 lines) plus `packages/database/src/client.ts` (111 lines) plus `pgbouncer/pgbouncer.ini` (78 lines).
**Fact:** Fragments are `note.prisma` plus `auditLog.prisma` plus `auditOutbox.prisma` plus `betterAuth.prisma`; migrations in `20260927080215_init` and `20260927080325_audit_outbox_retention_index`.
**Recommendation:** Change schema only via fragment edit then migrate then generate in same PR; never hand-edit applied `migration.sql`.
## 2. Runtime
**Fact:** Prisma 7 uses `PrismaPg` adapter over `pg.Pool` in `client.ts:38-69`; `DATABASE_URL` targets PgBouncer 6432, `DIRECT_URL` targets postgres 5432.
**Fact:** `prisma.config.ts:36-42` prefers injected `DIRECT_URL` then `DATABASE_URL`, fail-fast in production via `env(DIRECT_URL)` instead of silent pooler fallback.
**Fact:** `pgbouncer.ini:19-20` sets `pool_mode = transaction` with `max_prepared_statements = 200` so extended-protocol statements survive multiplexing.
**Interpretation:** Transaction mode lets short bursts share few server conns; session mode would pin conns and defeat the pooler.
## 3. Public API
**Fact:** Consumers import `db` from `@repo/database`; never construct `PrismaClient` directly except `client.ts` singleton and `seed.ts` bootstrap.
| Symbol | Contract | Source |
|---|---|---|
| db | pooled singleton via PgBouncer | packages/database/src/client.ts:107 |
| getPoolStats | total/idle/waiting/max snapshot | packages/database/src/client.ts:78-90 |
| addPoolErrorListener | idle-client error fan-out | packages/database/src/client.ts:30-36 |
**Fact:** Migrations run `prisma migrate deploy` (prod) or `prisma migrate dev` (local); run `prisma generate` after every fragment change.
## 4. Dependency direction
**Fact:** Allowed: api services into `db` singleton; `prisma.config.ts` into env snapshot; PgBouncer into postgres; migrate image into `DIRECT_URL` only.
**Fact:** Forbidden: web tier into `db` (Arch-B secret-free web); runtime queries via `DIRECT_URL`; migrate via pooler 6432 (advisory locks need session).
| Check | Grep |
|---|---|
| No direct client | rg -n new PrismaClient apps/api/src, expect only client plus seed |
| No pooler migrate | rg -n 6432 packages/database/prisma.config.ts, expect empty |
| No web DB import | pnpm guard:web-auth-imports plus guard:web-secrets --strict |
## 5. Security posture
**Fact:** Connection strings are server-only; `DIRECT_URL` never reaches web container (compose web env excludes PG keys; full rule in subsystems/security.md).
**Fact:** `pgbouncer.ini:64-65` uses `scram-sha-256` with `auth_file` userlist; admin binds container-internal only on `listen_port 6432`.
**Fact:** Audit tables carry no FK to users so deletes never cascade history; outbox purge is DONE-only (detail in audit subsystem).
## 6. Failure modes
**Fact:** Pool exhaustion surfaces as `query_wait_timeout 15s` from PgBouncer then `connectionTimeoutMillis 5000` in `client.ts:46-49`; ready 503, live 200.
**Fact:** Migrate via pooler fails on advisory locks and SET ROLE; missing `DIRECT_URL` in prod throws at `prisma.config.ts:40-42` by design.
**Fact:** Idle-client errors caught by `pool.on(error)` in `client.ts:53-63` and fanned out, never crashing Node on unhandled error event.
**Fact:** Kill-9 before commit rolls back business plus outbox rows (same-tx); mid-CLAIMED rows reclaimed after 30s.
## 7. Performance
**Fact:** Two-budget math from `cluster.ts:33-53` and `pgbouncer.ini:27-44`: workers x DATABASE_POOL_MAX within MAX_CLIENT_CONN, pooler DEFAULT 25 plus RESERVE 5 below POSTGRES_MAX 200.
**Fact:** Defaults are POOL_MAX 10, MAX_CLIENT 500, DEFAULT 25, MIN 10, RESERVE 5; k6 overlay is 50/1000/50/20/15 (see .env.k6.example:79-86).
**Fact:** Raising pools to 100/70 made 1k-RPS worse (IO-bound not conn-bound, noted in pgbouncer.ini:33-34); grow only with benchmark proof.
**Fact:** `server_idle_timeout 600s` keeps warm server conns; `reserve_pool_timeout 2s` absorbs bursts while alerts fire.
## 8. Config/Env
**Fact:** `DATABASE_URL` (pooler) and `DIRECT_URL` (direct) from `.env.example:88-91`; compose builds container URLs from hostnames, local uses localhost.
**Fact:** Pool knobs parse via `parsePositiveInt` in `client.ts:10-25` (digits-only, min 1 for max, throws on 10x or empty-via-compose edge).
**Fact:** Turbo passes DATABASE_URL plus DIRECT_URL for all db tasks in `turbo.json:241-264`; prod compose injects both explicitly.
## 9. Testing/verification
**Fact:** `packages/database/test/integration/prisma.integration.spec.ts` covers fragment shape plus generate plus deploy dry-run.
**Fact:** API `notes-rbac.integration.spec.ts` proves fresh-role reads survive transaction mode (no prepared-statement collision at 200).
**Fact:** Pool gauges via `getPoolStats()` in debug-prod triage; `performance.integration.spec.ts` checks pool math comments.
**Recommendation:** After model change run `pnpm db:migrate:dev --name slug` then `pnpm db:generate` then `test:integration -t notes-rbac`.
## 10. Extension pointer
**Recommendation:** Add model by copying `note.prisma` (cuid id, author FK cascade, composite author plus createdAt desc, map), permissions first, then migrate.
**Recommendation:** Add index only with covering-column reason plus tie-breaker for stable pagination; purge indexes stay SQL-only.
**Recommendation:** Follow workflows/add-model.md (future) for truncate order plus authz plus audit-plane check same PR.
## 11. AI-guidance
MUST: keep DIRECT_URL for migrate and seed and DATABASE_URL for runtime; keep pool_mode transaction plus max_prepared_statements 200.
MUST: keep disposeExternalPool true so disconnect ends pg pool on SIGTERM; keep parsePositiveInt digits-only; keep snapshot-before-dotenv in prisma.config.
MUST-NOT: run migrate deploy via 6432; construct second PrismaClient per request; cache query results module-level; paste migration.sql into wiki.
MUST-NOT: widen default_pool_size without k6 proof plus benchmark-report.mjs output attached to PR.
## 12. Common mistakes
**Interpretation:** Editing applied migration.sql instead of follow-up migration corrupts checksums and breaks deploy everywhere after first env.
**Interpretation:** Pointing runtime at DIRECT_URL to dodge queueing removes multiplexing and exhausts POSTGRES_MAX at workers x POOL_MAX scale.
**Interpretation:** Using bare Number for pool sizes turns 10x into silent truncation and empty into 0, yielding a pool that hangs forever.
**Interpretation:** Adding model without permission statement plus SCOPES leaves route open or 403-locked with no audit plane chosen.
## 13. Related
Invariants: INV-04 database-connections (pooler vs direct plus pool math; rules not repeated). Flows: flows/migration.md plus flows/authenticated-api.md (future). Subsystems: database-package.md plus audit.md plus api-runtime.md. Workflows: add-model.md plus add-domain-module.md (future). ADRs: ADR-0008 isolated-migrate-image (future).
## 14. Refs
packages/database/prisma/models/note.prisma, packages/database/prisma/models/auditLog.prisma, packages/database/prisma/models/auditOutbox.prisma, packages/database/prisma/models/betterAuth.prisma, packages/database/prisma/migrations/20260927080215_init/migration.sql, packages/database/prisma/migrations/20260927080325_audit_outbox_retention_index/migration.sql, packages/database/prisma.config.ts, packages/database/src/client.ts, packages/database/src/index.ts, pgbouncer/pgbouncer.ini, pgbouncer/userlist.txt, docker-compose.yml, apps/api/src/cluster.ts.
> **Uncertainty:** audit_log.targetId populate-vs-drop undecided; zero targetId writes exist and userId doubles as target. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q6; do not treat targetId as populated until ADR resolves it.
> **Uncertainty:** DLQ visibility has no alert, dashboard, or admin count; poison rows accumulate beyond BacklogHigh. See FINAL-10-OPEN-QUESTIONS.md Q9; query audit_outbox DLQ directly until alerting lands.
| Model | File | Purpose |
|---|---|---|
| note | prisma/models/note.prisma | demo domain seam, copy for Orders |
| auditLog | prisma/models/auditLog.prisma | append-only log, no FK |
| outbox | prisma/models/auditOutbox.prisma | durable queue, 30d DONE purge |
| auth | prisma/models/betterAuth.prisma | Better Auth tables, managed |
**Fact:** Schema source of truth is fragments plus migration.sql plus prisma.config.ts; prose here is descriptive and code wins on conflict.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
### Migration path reference
| Step | Command | File:Symbol |
|---|---|---|
| Fragment | edit prisma/models/<name>.prisma | copy note.prisma shape |
| Migrate dev | pnpm db:migrate:dev --name add_<name> | packages/database/package.json:27 |
| Generate | pnpm db:generate | prisma.config.ts schema prisma/ |
| Deploy prod | pnpm db:migrate:deploy | DIRECT_URL 5432, never 6432 |
| Verify | pnpm --filter api test:integration -t notes-rbac | guards pass |
### Pool math worked example
| Var | Prod | k6 overlay | Source |
|---|---|---|---|
| DATABASE_POOL_MAX | 10 | 50 | .env.example:27 vs .env.k6.example:79 |
| PGBOUNCER_MAX_CLIENT | 500 | 1000 | pgbouncer.ini:27 |
| DEFAULT plus RESERVE | 25 plus 5 equals 30 | 50 plus 15 equals 65 | pgbouncer.ini:35-44 |
| POSTGRES_MAX | 200 | 200 | .env.example:56 |
**Fact:** Both prod (30 below 200) and k6 (65 below 200) keep headroom for exporter plus migrate plus direct psql; spare slots cost about 10MB each.
**Fact:** Snapshot-before-dotenv in prisma.config.ts:13-14 prevents mounted root .env from backfilling DIRECT_URL with localhost in test and e2e containers.
**Recommendation:** Re-check pool math before raising API_WORKERS; per-worker pools multiply and pooler peak must stay below POSTGRES_MAX.
### Verification commands
**Fact:** Run pnpm --filter @repo/database build then db:generate then test:integration for prisma suite; run api notes-rbac for pooler-mode proof.
**Recommendation:** Diff pgbouncer.ini against .env.example PGBOUNCER plus POSTGRES values every pool PR; triple-source drift causes conn storms.
**Interpretation:** Prefer editing existing pool comments over reordering; each value carries a why comment and deleting it deletes the decision record.
### Fragment authoring checklist
**Fact:** Every fragment needs cuid id, author FK cascade where owned, composite author plus createdAt desc for list pagination, and map directive.
**Recommendation:** Copy note.prisma verbatim for Orders seam; change only names plus fields, keep index shape until query proves otherwise.
**Fact:** Better Auth fragment is vendor-managed; do not hand-edit auth tables to add app columns, use separate domain tables with FK.
**Recommendation:** Keep auditLog append-only; never add update path that rewrites history, use outbox redrive workflow for DLQ only.
**Fact:** Code wins over wiki; schema plus migrations win over prose per PHASE2-05 authority model.
