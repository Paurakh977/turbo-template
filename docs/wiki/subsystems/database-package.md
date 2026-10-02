---
title: "Subsystem: Database Package (Pool, Seed, Scripts, Stats)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/database-package.md"]
sources: ["packages/database/src/client.ts", "packages/database/src/seed.ts", "packages/database/src/env.ts", "packages/database/src/index.ts", "packages/database/package.json", "packages/database/prisma.config.ts"]
depends_on: ["invariants/04-database-connections.md"]
guards: ["packages/database/test/integration/prisma.integration.spec.ts", "apps/api/test/integration/modules/database-failure.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Database Package (Pool, Seed, Scripts, Stats)
> Up: ../00-INDEX.md | Depends on: INV-04 (database-connections). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `packages/database/src/client.ts` (pool plus singleton plus stats) plus `seed.ts` (118 lines, Better Auth API bootstrap) plus `env.ts` (seed env validation) plus `index.ts` re-export.
**Fact:** Scripts owned by `packages/database/package.json:20-30` (db:seed, db:generate, db:push, db:migrate:dev, db:migrate:deploy, db:studio) layered over `turbo.json:230-270` passThroughEnv.
**Recommendation:** Change pool, seed, or script only in these files; mirror env additions in `.env.example` plus turbo plus Joi same PR.
## 2. Runtime
**Fact:** `getPool()` in `client.ts:38-69` lazily creates one `pg.Pool` with `connectionString DATABASE_URL`, max via `parsePositiveInt(DATABASE_POOL_MAX,10,min1)`, timeouts 5000 and 30000.
**Fact:** `getClient()` in `client.ts:92-105` wraps pool in `PrismaPg` with `disposeExternalPool:true` so `db.disconnect` ends pool for SIGTERM draining.
**Fact:** Non-production caches singleton in `globalForPrisma` (`client.ts:109-111`); production creates fresh per worker process to avoid cross-worker socket sharing.
**Interpretation:** Lazy singleton plus global cache is what keeps HMR and tests from leaking pools; eager creation would connect during import.
## 3. Public API
**Fact:** Package exports `db`, `getPoolStats`, `addPoolErrorListener`, plus `getSeedEnv` from `env.ts`; generated client types flow via `src/generated/prisma/client`.
| Symbol | Contract | Source |
|---|---|---|
| db | singleton PrismaClient over pooled pg | packages/database/src/client.ts:107 |
| getPoolStats | total/idle/waiting/max, zero when no pool | packages/database/src/client.ts:78-90 |
| seed | idempotent super-admin bootstrap via sign-up API | packages/database/src/seed.ts:20-111 |
**Fact:** Seed is idempotent: existing admin is normalized plus promoted if needed (`seed.ts:36-64`); missing admin triggers Better Auth sign-up then promote (`seed.ts:81-108`).
## 4. Dependency direction
**Fact:** Allowed: api services into `db`; seed into Better Auth HTTP API plus `db.user.update`; `env.ts` into process env; turbo db tasks into DATABASE_URL plus DIRECT_URL.
**Fact:** Forbidden: importing `@repo/auth` inside database package (circular; seed imports only `@repo/roles` parse plus serialize); web into database package.
| Check | Grep |
|---|---|
| No auth import | rg -n "@repo/auth" packages/database/src, expect empty |
| No second client | rg -n "new PrismaClient" packages/database/src, expect client plus seed only |
| Seed role canonical | rg -n "parseRoles|serializeRoles" packages/database/src/seed.ts, expect both |
## 5. Security posture
**Fact:** Seed password enforced min 12 chars (`seed.ts:28-30`); admin promotion forces `emailVerified:true` plus canonical `serializeRoles(superAdmin)`.
**Fact:** Seed origin prefers `NEXT_PUBLIC_APP_URL` then `BETTER_AUTH_URL` (`seed.ts:78-79`) to pass trustedOrigins CSRF check; never bypasses auth hashing.
**Fact:** Pool error listener swallows listener exceptions (`client.ts:57-61`) so observability hooks cannot crash pool handler; idle errors logged with prefix.
## 6. Failure modes
**Fact:** Invalid pool env throws at boot (`parsePositiveInt` digits-only, min 1); empty-via-compose falls back silently, non-digits fail fast with name plus value.
**Fact:** Pool max 0 is rejected (would hang forever acquiring); `connectionTimeoutMillis` plus `idleTimeoutMillis` bound waits instead of queueing forever.
**Fact:** Seed sign-up failure throws with status plus body (`seed.ts:94-97`); promote path never creates duplicate admin due to findUnique gate.
**Fact:** PG down surfaces as ready 503 (database error) while live stays 200; `database-failure.integration.spec.ts` locks this split-brain contract.
## 7. Performance
**Fact:** Pool defaults 10/5000/30000 balance burst absorption vs idle churn; k6 raises to 50/10000/30000 for 1500-VU shared-IP load (see .env.k6.example:79-81).
**Fact:** `getPoolStats()` exposes total plus idle plus waiting plus max for Grafana plus debug-prod triage; waiting growth is the scale signal before 503s.
**Fact:** Seed does one findUnique plus at most one sign-up plus one update; safe to run on every deploy, no N+1, no bulk insert path.
**Fact:** Global singleton in dev avoids pool-per-HMR leak; production per-worker pools budgeted by workers x POOL_MAX math (see database-prisma.md).
## 8. Config/Env
**Fact:** Pool reads `DATABASE_URL` plus `DATABASE_POOL_MAX` plus `DATABASE_CONNECTION_TIMEOUT_MS` plus `DATABASE_IDLE_TIMEOUT_MS` (see .env.example:27-29).
**Fact:** Seed reads `SEED_ADMIN_EMAIL` plus `SEED_ADMIN_PASSWORD` plus `SEED_ADMIN_NAME` plus `BETTER_AUTH_URL` via `getSeedEnv()` in `src/env.ts`; turbo db:seed passes them (`turbo.json:230-240`).
**Fact:** `prisma.config.ts` snapshot-before-dotenv plus turbo `db:generate` passThrough DATABASE_URL plus DIRECT_URL keep local generate offline-safe.
## 9. Testing/verification
**Fact:** `prisma.integration.spec.ts` covers client singleton plus stats shape plus env parsing plus generate smoke; run `pnpm --filter @repo/database test`.
**Fact:** `database-failure.integration.spec.ts` kills PG and asserts ready 503 vs live 200 plus pool error listener fires without crash.
**Fact:** Seed verified in e2e via TRUNCATE plus retry plus states (see flows/e2e.md future); seed TRUNCATE order must respect FK cascade (users before notes).
**Recommendation:** After pool change run `test:integration -t database-failure` plus `performance.integration.spec.ts` before merge.
## 10. Extension pointer
**Recommendation:** Add consumer script by adding npm script in `packages/database/package.json` plus turbo passThroughEnv plus `.env.example` row same PR.
**Recommendation:** Add seed mailbox only as template placeholder (never real mailbox); keep role canonical via `parseRoles` plus `serializeRoles` from day one.
**Recommendation:** Expose new pool gauge only via `getPoolStats` extension, never by exporting raw `pg.Pool`; keep pool ownership inside `client.ts`.
## 11. AI-guidance
MUST: keep singleton plus global cache in non-prod; keep disposeExternalPool true; keep digits-only parsers; keep seed idempotent plus 12-char floor.
MUST: keep `@repo/roles` import in seed (not `@repo/auth`); keep origin fallback NEXT_PUBLIC_APP_URL then BETTER_AUTH_URL; keep turbo passThrough for db tasks.
MUST-NOT: create PrismaClient per request; export raw pool; hash passwords in seed (call Better Auth API); paste seed secrets into wiki or logs.
MUST-NOT: raise POOL_MAX without workers x pool math plus k6 proof; delete seed file to save weight (migrate image needs transplant, see ADR-0008 future).
## 12. Common mistakes
**Interpretation:** Calling `new PrismaClient` in a service to get fresh data bypasses pooling and leaks sockets on every request; import `db` singleton instead.
**Interpretation:** Hashing seed password with bcrypt directly drifts from Better Auth implementation; call sign-up API so hashing plus IDs stay in sync.
**Interpretation:** Using `Number()` for pool env turns empty into 0 (hang) and 10x into 10 (silent); `parsePositiveInt` exists to fail fast instead.
**Interpretation:** Running seed against pooler URL under load starves runtime conns; seed plus migrate use DIRECT_URL by contract, runtime uses pooler.
## 13. Related
Invariants: INV-04 database-connections (pool math; rules not repeated). Flows: flows/migration.md plus flows/e2e.md (future seed path). Subsystems: database-prisma.md plus docker-environments.md plus env-config.md. Workflows: add-model.md plus change-docker-env.md (future). ADRs: ADR-0008 isolated-migrate-image (future).
## 14. Refs
packages/database/src/client.ts, packages/database/src/seed.ts, packages/database/src/env.ts, packages/database/src/index.ts, packages/database/package.json, packages/database/prisma.config.ts, packages/database/test/integration/prisma.integration.spec.ts, apps/api/test/integration/modules/database-failure.integration.spec.ts, turbo.json, .env.example, docker-compose.yml.
> **Uncertainty:** DLQ visibility gap means outbox poison rows sit invisible beyond BacklogHigh max over 500; no DLQ alert or admin count exists. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q9; SELECT DLQ directly and follow redrive-dlq workflow (future) until alert lands.
> **Uncertainty:** audit_log.targetId is dead today (zero writes) but retained; userId doubles as target. See FINAL-10-OPEN-QUESTIONS.md Q6; do not add targetId reads in new seed or stats code until ADR populates or drops it.
| Script | Command | Env |
|---|---|---|
| db:seed | tsx src/seed.ts | DATABASE_URL plus SEED_ADMIN plus BETTER_AUTH_URL |
| db:generate | prisma generate | DATABASE_URL plus DIRECT_URL |
| db:migrate:dev | prisma migrate dev | DIRECT_URL required, pooler forbidden |
| db:migrate:deploy | prisma migrate deploy | DIRECT_URL 5432 in prod |
| db:studio | prisma studio | DIRECT_URL, local only |
### Seed idempotency matrix
| State | Action | Result |
|---|---|---|
| No admin | sign-up API then promote | superAdmin created, verified |
| Existing non-admin | update role plus verified | promoted, no duplicate |
| Existing superAdmin | normalize role if drifted | skipped, log only |
**Fact:** Package is template-owned durability seam; transplant-not-regenerate per extension/seam-catalog.md (future); code wins over prose.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
### Pool observer snippet
**Fact:** `getPoolStats()` returns zeros before first `getPool()` call; callers must handle cold-start zeros vs real exhaustion (waiting over 0 is signal).
**Recommendation:** Alert on waitingCount growth plus total near max, not on idle alone; idle fluctuates with traffic and means nothing solo.
**Interpretation:** Exporting raw pool to add custom query helper tempts bypass of Prisma adapter safety; extend via Prisma extension, not raw pg.
### Env parser contract
| Var | Fallback | Invalid handling | Source |
|---|---|---|---|
| DATABASE_POOL_MAX | 10, min 1 | throw whole-number error | client.ts:10-25 |
| CONNECTION_TIMEOUT | 5000 | throw on non-digits | client.ts:46-49 |
| IDLE_TIMEOUT | 30000 | throw on non-digits | client.ts:50 |
| SEED_ADMIN_PASSWORD | none, min 12 | throw below 12 | seed.ts:28-30 |
**Fact:** Empty-via-compose (dollar VAR colon-dash empty) falls back silently by design; non-empty non-digits always throw at boot, never NaN.
**Recommendation:** Mirror every new pool knob in .env.example plus turbo passThrough plus Joi or parsePositiveInt same PR or boot diverges.
**Fact:** Shutdown hook calls db.disconnect which ends pg pool via disposeExternalPool; missing this leaves SIGTERM hanging past grace.
**Recommendation:** Keep poll plus purge timers unrefd so SIGTERM is not delayed by idle database timers; verify via debug-prod workflow (future).
**Fact:** Code wins over wiki; package source plus migrations win over prose per authority model.
**Recommendation:** Do not read whole wiki for pool tuning; follow task route T3 add-model bundle in order per 00-INDEX (future).
### Consumer runbook
**Fact:** Local dev runs `pnpm db:migrate:dev` then `pnpm db:seed`; CI runs migrate deploy then seed once before e2e.
**Recommendation:** Never commit real mailboxes in seed defaults; template placeholders match .env.example seed values only.
**Fact:** Studio is local-only; never expose studio in prod compose or gate it behind admin auth if ever needed.
**Recommendation:** Keep seed logs grep-friendly with Seed prefix; do not log passwords or tokens even on failure.
