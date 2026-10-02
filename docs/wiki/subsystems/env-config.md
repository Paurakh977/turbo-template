---
title: "Subsystem: Env Config (Single Source, Validators, Ownership)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/env-config.md"]
sources: [".env.example", "apps/api/src/app.module.ts", "packages/auth/src/config/env.ts", "packages/database/src/client.ts", "packages/database/src/env.ts", "turbo.json", "apps/api/src/load-env.ts", "packages/auth/src/config/load-env.ts"]
depends_on: ["invariants/09-env.md"]
guards: ["scripts/check-web-secrets.mjs", "packages/auth/src/config/env.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Env Config (Single Source, Validators, Ownership)
> Up: ../00-INDEX.md | Depends on: INV-09 (env). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `.env.example` (344 lines, single source of truth) plus `apps/api/src/app.module.ts:65-145` Joi validator plus `packages/auth/src/config/env.ts` (70 lines, parseIntEnv) plus `packages/database/src/client.ts:10-25` parsePositiveInt.
**Fact:** Loaders owned by `apps/api/src/load-env.ts` (10 lines) plus `packages/auth/src/config/load-env.ts` plus `apps/web/next.config.js` dotenv layering plus `turbo.json` passThroughEnv allowlists.
**Recommendation:** Add var only via .env.example row plus validator plus turbo passThrough plus compose environment same PR; missing any one diverges tiers.
## 2. Runtime
**Fact:** Docker Compose substitutes dollar VAR from `.env` into containers; container env always wins over file (see .env.example:1-7 header contract).
**Fact:** Local apps load root `.env` via dotenv (`load-env.ts:4-5`); when `K6_TESTING=true`, root `.env.k6` layers on top with override true (`load-env.ts:8-10`).
**Fact:** Compose never reads `.env.k6`; host-run k6 mode (infra via local profile plus apps on host) is the only path where `.env.k6` applies (see .env.k6.example:1-25).
**Interpretation:** Single file plus explicit layering is what keeps prod, dev, test, e2e, k6 from drifting; second source would fork behavior silently.
## 3. Public API
**Fact:** Env is read only via `getEnv` plus `parseIntEnv` (auth) plus `parsePositiveInt` (database) plus `parseThrottleInt` (api) plus Joi schema (api boot); never via bare `process.env` in services.
| Helper | Contract | Source |
|---|---|---|
| getEnv | trim plus throw if required missing | packages/auth/src/config/env.ts:1-7 |
| parseIntEnv | digits-only, min, throw, empty fallback | packages/auth/src/config/env.ts:53-70 |
| parsePositiveInt | same for pool, min 1 for max | packages/database/src/client.ts:10-25 |
| parseThrottleInt | same for throttler, min 1 | apps/api/src/app.module.ts:40-51 |
**Fact:** `BUILD_SECRET_PLACEHOLDER` allows `next build` page-data collection without real secret; `auth.ts` refuses to boot prod on placeholder (see security).
## 4. Dependency direction
**Fact:** Allowed: api plus auth plus database plus web into process env via helpers; turbo into env passthrough; compose into container environment.
**Fact:** Forbidden: web runtime reading DATABASE_URL or BETTER_AUTH_SECRET or PG keys (Arch-B); baking runtime secrets into NEXT_PUBLIC image; copying .env into image.
| Check | Grep |
|---|---|
| No web secret | pnpm guard:web-secrets --strict, plus rg DATABASE_URL apps/web/src expect empty |
| No web auth root | pnpm guard:web-auth-imports, plus rg from db plus auth root in web expect empty |
| Single source | rg -n "^DATABASE_URL" .env.example .env.k6.example, expect both but k6 overlay only |
## 5. Security posture
**Fact:** `BETTER_AUTH_SECRET` min 32 enforced by Joi (`app.module.ts:75`); seed password min 12 (`seed.ts:28-30`); `RESEND_API_KEY` required in prod or verification silently relaxes.
**Fact:** `usingPlaceholderSecret` blocks prod boot on build-time stand-in (`env.ts:29-30`); dev falls back to `dev-secret` only when not production.
**Fact:** `NEXT_PUBLIC_*` baked at `next build` time (Faro collector plus app URL plus version); changing them requires web rebuild, never runtime injection.
## 6. Failure modes
**Fact:** Missing required Joi key fails fast at boot with one structured error listing every missing key (abortEarly false); OTel keys required unless OTEL_SDK_DISABLED true.
**Fact:** Empty-via-compose (`dollar VAR colon-dash empty`) falls back silently to code defaults; non-empty non-digits throw with name plus value (never NaN or truncation).
**Fact:** `Number(empty) === 0` plus `parseInt(7d) === 7` bugs are why digits-only regex exists; bare Number would misconfigure ttl 0 or 7-second sessions.
**Fact:** Wrong `.env.k6` usage (compose --env-file without required OTEL plus GIT plus GF keys) fail-fasts on missing keys; copy from `.env` per .env.k6.example:118-139.
## 7. Performance
**Fact:** Env parsing is boot-only (no per-request cost); pool plus throttle plus session tuning via env affect runtime throughput without code change.
**Fact:** `DATABASE_POOL_MAX` per worker (10 prod, 50 k6) times workers budgeted against pooler; `API_WORKERS` 1 prod, matrix 1/2/4/8 for capacity runs.
**Fact:** Checkpoint plus WAL plus shared_buffers via POSTGRES_* require postgres recreate (data volume preserved); memory suffixes kB/MB/GB, times ms/s/min/h/d.
**Fact:** Faro baked version via GIT_SHA avoids runtime version lookup per beacon; compose maps GIT_SHA into OTEL plus FARO version keys.
## 8. Config/Env
**Fact:** Canonical rows live in `.env.example:10-344` grouped by API, Web, Postgres, PgBouncer, Auth, Seed, Rate, Throttler, Workers, Proxy, Nginx, Observability, Faro.
**Fact:** `turbo.json:18-77` dev plus start plus build plus test plus e2e plus db tasks each declare passThroughEnv; missing entry silently drops var in that task.
**Fact:** `INTERNAL_API_URL` is compose-injected in containers, localhost fallback for host runs (`.env.example:223`); `K6_TESTING` gates `.env.k6` layering only.
## 9. Testing/verification
**Fact:** `packages/auth/src/config/env.spec.ts` covers getEnv plus parseIntEnv empty-fallback plus digits-only plus min-plus-throw; run `pnpm --filter @repo/auth test`.
**Fact:** `scripts/check-web-secrets.mjs` plus `check-web-auth-imports.mjs` prove Arch-B secret-free web; run `pnpm guard:web-secrets --strict` plus `guard:web-auth-imports`.
**Fact:** Joi validation covered by boot tests (missing key lists all); e2e plus test profiles set OTEL_SDK_DISABLED true to allow missing collectors.
**Recommendation:** After new var run env.spec plus guards plus `compose config` lint plus e2e boot plus migrate DIRECT_URL check before merge.
## 10. Extension pointer
**Recommendation:** Add var by .env.example row (with comment plus prod vs k6 values) then Joi or parser entry then turbo passThrough then compose environment then guard update same PR.
**Recommendation:** Add baked (NEXT_PUBLIC) var only if browser truly needs it; prefer server gateway plus INTERNAL_API_URL to keep secrets server-only.
**Recommendation:** Follow workflows/change-docker-env.md (future) for profile plus Dockerfile plus overlay plus ARG-vs-ENV baked-vs-runtime checklist.
## 11. AI-guidance
MUST: keep single source .env.example; keep fail-fast (Joi plus parsers throw, never NaN); keep empty-means-fallback; keep turbo passThrough in sync.
MUST: keep web secret-free (no DATABASE_URL, SECRET, PG keys in web env); keep NEXT_PUBLIC baked (rebuild after change); keep placeholder-secret boot guard.
MUST-NOT: read process.env bare in services; use Number or parseInt without digits check; copy .env into image; reuse .env for tests (use .env.test).
MUST-NOT: set NODE_TLS_REJECT_UNAUTHORIZED 0 in prod or prod-like host runs; local-dev only and honored by every Node process loading env.
## 12. Common mistakes
**Interpretation:** Adding var to .env.example but not turbo passThrough makes it vanish in that task with no error; turbo allowlist is the second gate.
**Interpretation:** Using `Number(VAR fallback)` with empty-via-compose yields 0 (ttl 0, limit 0) and silent misconfig; digits-only parsers exist to throw instead.
**Interpretation:** Baking BETTER_AUTH_SECRET into image to fix build-time import bakes a secret into layers; use BUILD_SECRET_PLACEHOLDER plus runtime env instead.
**Interpretation:** Reusing .env for integration tests pollutes prod-shaped data; template requires .env.test copy (see .env.example:327-344) plus tmpfs profile.
## 13. Related
Invariants: INV-09 env (single source plus fail-fast plus baked vs runtime; rules not repeated). Flows: flows/migration.md plus flows/e2e.md (future). Subsystems: docker-environments.md plus database-prisma.md plus security.md. Workflows: change-docker-env.md (future). ADRs: ADR-0010 baked-RUM plus ADR-0003 Arch-B (future).
## 14. Refs
.env.example, .env.k6.example, .env.test.example, apps/api/src/app.module.ts, packages/auth/src/config/env.ts, packages/auth/src/config/load-env.ts, packages/database/src/client.ts, packages/database/src/env.ts, apps/api/src/load-env.ts, turbo.json, docker-compose.yml, apps/web/next.config.js, scripts/check-web-secrets.mjs, scripts/check-web-auth-imports.mjs.
> **Uncertainty:** OTel exporter vs Alloy compat plus Tempo retention plus Pyroscope arm64 are unverified with alloy latest unpinned. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11; do not assert OTEL env semantics beyond fail-fast plus rewrite alloy to localhost for host runs until pin plus retention docs land.
| Var | Consumers | Secret | Validated by |
|---|---|---|---|
| DATABASE_URL | api, migrate, seed | yes | Joi uri plus pool parser |
| DIRECT_URL | migrate, studio, prisma.config | yes | prisma.config fail-fast |
| REDIS_URL | api, auth secondaryStorage | yes | Joi uri |
| BETTER_AUTH_SECRET | api only | yes | Joi min 32 plus placeholder guard |
| NEXT_PUBLIC_APP_URL | web baked plus api CORS | no | Joi uri, rebuild on change |
| API_WORKERS | api cluster | no | cluster cap 8, pool math |
**Fact:** Ownership table source is .env.example plus Joi plus auth env plus pool parsers plus turbo plus compose; prose here is descriptive and code wins.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
### Add-var checklist
| Step | File | Done when |
|---|---|---|
| Row | .env.example | comment plus prod vs k6 plus secret flag |
| Validate | app.module Joi or parseIntEnv | boot throws with name on bad |
| Pass | turbo.json task | var present in that task run |
| Inject | docker-compose.yml | environment entry plus fail-fast |
| Guard | check-web plus env.spec | secret-free plus parser tests pass |
### Baked vs runtime matrix
| Kind | Examples | Change needs | Source |
|---|---|---|---|
| Baked | NEXT_PUBLIC_API_URL, FARO keys | web rebuild | next.config.js plus turbo build env |
| Runtime | DATABASE_URL, SECRET, OTEL | container restart | compose environment |
| Test-only | REDIS_PREFIX, OAUTH_TEST | test profile only | .env.test plus turbo test |
**Fact:** Baked values are inlined at next build; runtime values arrive via compose environment and never live in image layers.
**Recommendation:** Prefer runtime gateways over new NEXT_PUBLIC vars; every baked var grows rebuild surface and risks secret baking.
**Fact:** Code wins over wiki; .env.example plus validators plus turbo win over prose per authority model.
**Recommendation:** Do not read whole wiki for env change; follow task route T7 docker-env bundle in order per 00-INDEX (future).
### Verification commands
**Fact:** Run pnpm guard:web-secrets --strict plus guard:web-auth-imports plus env.spec plus compose config for env PRs.
**Fact:** Load order is root .env first then .env.k6 override when K6_TESTING true; container injected env always wins over both files.
**Recommendation:** Keep K6_TESTING false in prod and dev; true only for host-run load stacks per .env.example:197 plus .env.k6.example:38.
**Fact:** E2E plus test profiles isolate via .env.e2e plus .env.test with tmpfs postgres plus small redis; never point tests at dev DB.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
**Fact:** SECRET rotation needs api restart plus session invalidation review; see auth subsystem plus FINAL-10 Q4 active-sessions note.
**Recommendation:** Document rotation in same PR as new secret var; never log secret values even on validation failure (name plus shape only).
