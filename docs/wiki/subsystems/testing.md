---
title: "Subsystem: Testing (Jest, Integration, Playwright, k6, Guards)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/testing.md"]
sources: ["apps/api/jest.config.ts", "apps/api/test/integration/helpers/test-app.ts", "apps/web/playwright.config.ts", "k6/config.js", "scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
depends_on: ["invariants/07-health.md"]
guards: ["k6/tests/runner-contract.mjs", "apps/api/test/integration/modules/health.integration.spec.ts", "apps/web/e2e/tests/health/health.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Testing (Jest, Integration, Playwright, k6, Guards)
> Up: ../00-INDEX.md | Depends on: INV-07 (health probes under load). Method rules live in reference/test-matrix.md (future); this file owns the harness map.
## 1. Ownership
**Fact:** Four tiers with no overlap: unit (jest hermetic) owned by apps/api/jest.config.ts plus src specs and packages specs; integration (real DB plus Redis plus Auth) owned by apps/api/test/integration (3 configs plus helpers plus 24 module specs); e2e (real nginx TLS) owned by apps/web/playwright.config.ts plus e2e tests; load (real limits) owned by k6 suites plus scenarios plus helpers plus runners.
**Fact:** Shared foundation owned by packages/jest-config (base, nest, next entry); guards owned by scripts/check-web-secrets.mjs plus check-web-auth-imports.mjs plus benchmark-report.mjs plus scaffold tests; orchestration owned by turbo.json passThroughEnv plus root package.json scripts plus compose test and e2e profiles.
**Fact:** Each tier answers a different question: unit catches logic, integration catches wiring and RBAC, Playwright catches browser plus proxy plus SSR, k6 catches limits and perf; never substitute one tier for another.
## 2. Runtime
**Fact:** Unit: jest.config extends nestConfig with reflect-metadata setup and thallesp stub mapper; testRegex spec.ts with rootDir src so test integration specs are never picked up; web jest maps pure subpaths (roles, permissions, ui, api entry, server-only stub) enforcing Architecture B at test time.
**Fact:** Integration: default config ignores strict plus oauth suites, transform ts-jest useESM with tsconfig.test.json, mapper to src, timeout 30s, maxWorkers 1; strict adds resend mock with canSendEmail true, oauth adds OAUTH_TEST_PROVIDER 1 with DummyOAuthController on 127.0.0.1:3001; setup files set env BEFORE load-env locks root .env (ports 5433 plus 6380, RATE_LIMIT_MAX 9999, relaxed verification default).
**Fact:** Shared app: createTestApp mirrors trust proxy, helmet, compression, prefix api, ValidationPipe, HttpExceptionFilter, CORS, singleton via Symbol.for with close noop and forceExit teardown; bootstrap about 30s paid once per run, suites sequential.
**Fact:** Playwright: workers 1 fullyParallel false (shared seeded DB plus Redis plus rate buckets), 6 projects (user, operator, admin, superadmin, unauthenticated, mobile Pixel 5), ipv4first for nginx IPv4, baseURL https localhost 8443 with ignoreHTTPSErrors, global setup waits ready up to 180s then seeds 4 role accounts with storage states, teardown truncates plus flushes.
## 3. Public API
| Command | Tier | Source |
|---|---|---|
| pnpm --filter api test | Unit hermetic | apps/api/package.json |
| pnpm --filter api test:integration:all | Integration default plus strict plus oauth | apps/api/package.json |
| pnpm --filter web test:e2e | Playwright full matrix | apps/web/package.json |
| pnpm k6:smoke, load, stress, spike, soak, capacity, edge | Load with thresholds | root package.json |
| pnpm guard:web-secrets, guard:web-auth-imports | Architecture B guards | scripts |
**Fact:** k6 thresholds: 5xx rate under 1 percent scoped to 500 plus 502 plus 503 plus 504 (http_req_failed counts 429 so never gate on it raw), checks above 99 percent (capacity 95), 429 visibility report-only, capacity also gates dropped iterations zero with no latency gate.
## 4. Dependency direction
**Fact:** Allowed: specs into helpers (auth, database, redis, email, totp, rbac-matrix) plus fixtures (users, notes); e2e specs into page-objects plus helpers plus fixtures; k6 suites into scenarios plus helpers (auth cookie, http traceparent, setup once, data, summary); guards into standalone build output.
**Fact:** Forbidden: unit MUST NOT touch PG or Redis; e2e seed MUST NOT randomize emails; Playwright MUST NOT raise workers above 1 against the shared seeded stack; k6 MUST NOT add a bypass header (empty limit_req keys uncounted equals global disable); web unit MUST NOT import DB-backed auth root.
| Check | Grep |
|---|---|
| No live deps in unit | rg -n 5432\|6379\|5433\|6380 apps/api/jest.config.ts apps/api/test/jest-e2e.json, expect none |
| Workers pinned | rg -n workers apps/web/playwright.config.ts, expect 1 |
| No bypass header | rg -ni bypass k6/config.js k6/run.ps1 k6/run.sh, expect only never-add comments |
## 5. Security posture
**Fact:** Guards enforce Architecture B where types and lint cannot: check-web-secrets scans standalone output for DATABASE_URL plus PGPASSWORD plus PGUSER plus PGHOST (BETTER_AUTH_SECRET presence enforced by compose inject-nothing plus docker exec printenv); check-web-auth-imports rejects runtime from auth root after masking type-only imports, allowing roles plus permissions plus password-policy subpaths.
**Fact:** Seed isolation: e2e uses env-file creds plus ports 5434 plus 6381, never test ports; storage states regenerated per run under e2e/.auth; committed auth json treated as stale artifact overwritten by globalSetup.
**Fact:** k6 runs real limits with no bypass header and insecure-skip-tls-verify plus ignoreHTTPSErrors; cert errors masked in both harnesses by design for local nginx, never asserted as passing TLS verification.
## 6. Failure modes
**Fact:** Signup 429 during seed mitigated by flush plus retry (4 attempts, flush plus 100ms); tmpfs versus volume timing drift between test and prod migrate images (Dockerfile.dev versus slim migrate image) unverified.
**Fact:** Visual win32 font drift pins snapshots per role plus mobile; soak plus capacity contention on shared runners flakes latency gates, so capacity carries no latency gate by design.
**Fact:** Turbo never loads .env; missing passThroughEnv surfaces as silent undefined in cached tasks, so new vars must be added to every task needing them the same PR as code use.
**Fact:** Stale dist versus src divergence possible because test has no dependsOn build; single-spec green can still break cross-suite state, so test-integration-all is the unit of green.
## 7. Performance
**Fact:** Shared-app singleton pays bootstrap about 30s once per run; maxWorkers 1 keeps suites sequential and deterministic against shared DB plus Redis plus rate buckets.
**Fact:** k6 think times (smoke 2s, load 0.5 plus jitter 1.5, stress 0.2 plus jitter 0.5, spike 0.1, soak 1, edge 1) plus setup-once admin session keep load realistic and observable with W3C traceparent injection.
**Fact:** Traffic mix load (public 0.4, notes 0.35, audit 0.15, auth 0.1) and capacity (notesRead 0.4, notesWrite 0.25, rateLimit 0.2, health 0.15) separate ceiling measurement from gating suites; benchmark-report closes the loop without scraping.
## 8. Config/Env
**Fact:** turbo test passThroughEnv allowlists DATABASE_URL, REDIS_URL, AUDIT_OUTBOX_POLL_DISABLED, BETTER_AUTH_SECRET, BETTER_AUTH_URL, APP_NAME; test:e2e adds trusted origins, app URL, e2e DB plus Redis URLs, seed admin, TLS, CI, base URL, rate limits; test:integration adds NODE_ENV, NODE_OPTIONS, REDIS_PREFIX, email flags, resend key, host plus port, rate max plus window, OAUTH_TEST_PROVIDER, cache false.
**Fact:** Global passThrough CI flags plus telemetry opt-outs, globalEnv NODE_ENV, globalDependencies env local; e2e playwright env loads .env.e2e with rate window 5 max 1000 and test.local domain.
**Fact:** Compose test profile (tmpfs postgres, 64mb redis, migrate-test with DIRECT_URL backfill guard, api-test turbo integration all) versus e2e profile (postgres-e2e plus redis-e2e plus migrate-e2e plus api-e2e plus web-e2e plus proxy-e2e with 8080 plus 8443); CI runs test before e2e; local integration only after cp .env.test .env.
## 9. Testing/verification (matrix)
**Fact:** Change to required-tests matrix: DTO and validation into web jest plus api unit plus notes integration plus e2e notes; RBAC and permission into roles spec plus auth specs plus notes-rbac plus admin-mutations plus e2e rbac and admin plus k6 edge; auth session 2FA OAuth into auth specs plus 2fa oauth jwt auth-session security plus e2e auth plus k6 auth-flow.
**Fact:** Rate and nginx into rate-limit specs plus e2e ratelimit plus k6 spike and stress; audit outbox into audit specs plus e2e audit plus k6 audit-flow; health into health spec plus e2e health plus k6 public-flow plus compose healthchecks; web SSR and actions into web jest plus e2e settings notes errors plus k6 web-flow plus guards.
**Fact:** Env Joi compose into e2e-env plus all setups plus k6 runner test plus guards; k6 threshold and suite into runner test plus benchmark plus dry-run. Always: turbo lint, turbo typecheck, both web guards, runner test when touching runners.
## 10. Extension pointer
**Recommendation:** New domain MUST add fixture plus role assignment (prefer registerUserViaApi for session path, createTestUser for matrix speed), page-object plus helper plus spec for e2e, scenario hooks for k6, and one row in the change-to-test matrix the same PR.
**Recommendation:** New package MUST reuse jest-config base or nest entry; do not inline transform. New vendor ESM-only dep MUST get a stub plus mapper in both api configs. New role MUST join E2E_USERS plus seed plus project together; never randomize e2e emails.
## 11. AI-guidance
MUST: pick the spec suffix deliberately (default versus strict versus oauth); mirror every main.ts pipeline change in test-app.ts; keep workers 1 and fullyParallel false; keep 5xx plus checks plus dropped as the invariant gates with 429 visibility report-only; keep cache false on integration tasks.
MUST-NOT: run test or e2e profiles against real ports or creds; set OAUTH_TEST_PROVIDER in .env.test; raise Playwright workers for speed; gate k6 on raw http_req_failed including 429; assert visual snapshots across OS without regenerating.
## 12. Common mistakes
**Interpretation:** Substituting unit green for integration green misses wiring and RBAC faults; shared-app plus seeded DB mean cross-suite state breaks silently without test-integration-all.
**Interpretation:** Importing app code in setup files locks dotenv before env is set; setups set process.env only, mirroring new Joi keys across all three.
**Interpretation:** Leaving secrets check report-only lets violations merge; promote strict to CI fail per the matrix recommendation.
**Interpretation:** Treating capacity ceiling as a gate fails the suite by design; capacity measures, smoke through soak gate.
## 13. Related
Invariants: INV-07 (probes), plus per-change invariants via the matrix (pointers only). Subsystems: api-runtime.md (pipeline mirrored), auth-better-auth.md plus rbac-rules-users.md plus audit.md (suites per area), security.md (guard contracts), plus future redis, nginx-edge, web-runtime, docker-environments, k6-performance owners. Reference: test-matrix.md, ports-topology.md (future). Research: dated k6 baselines (future, expire 6mo).
## 14. Refs
apps/api/jest.config.ts, apps/api/test/jest-e2e.json, test/app.e2e-spec.ts, test/e2e-env.ts, test/stubs, test/integration configs plus setups plus jest-run.cjs, helpers/test-app.ts plus auth plus database plus redis plus email plus totp plus rbac-matrix plus resend-mock plus dummy-oauth.controller, fixtures/users.ts plus notes.ts, 24 module integration specs, packages specs, apps/web/jest.config.ts, playwright.config.ts, e2e global setup plus teardown plus seed plus cleanup plus config plus helpers plus fixtures plus pages plus factories plus 15 specs, k6/config.js plus suites plus scenarios plus helpers plus runners, scripts/check-web-secrets.mjs plus check-web-auth-imports.mjs plus benchmark-report.mjs plus scaffold, turbo.json, docker-compose.yml test plus e2e profiles.
> **Uncertainty:** app.e2e-spec.ts expects GET slash Hello World without the api prefix, stale versus setGlobalPrefix api in main.ts:128; integration middleware.spec asserts health/live 404. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q1; run the stub suite and fix or delete before trusting e2e green.
### Suite inventory reference
| Suite | Files | Isolation |
|---|---|---|
| API unit | src specs beside source | hermetic, stubbed vendor auth, mocked db redis |
| API e2e stub | jest-e2e.json plus app.e2e-spec plus stubs | routing only, never PG or Redis |
| Integration default | 20 plus module specs | real DI plus DB plus Redis plus Auth, relaxed email |
| Integration strict | email-verification strict spec | resend mock, verification enforced |
| Integration oauth | oauth spec plus dummy controller | OAUTH_TEST_PROVIDER 1, offline nock |
| Package unit | auth, roles, database specs | shared contract per package |
| Web unit | src specs with mappers | component and action logic, no Next server |
| Playwright | 15 specs plus pages plus helpers | real nginx TLS, seeded stack |
| k6 | 7 suites plus 7 scenarios | real limits, thresholds per suite |
### k6 suite reference
| Suite | Shape | Gates |
|---|---|---|
| smoke | 2 VUs 30s all flows think 2s | 5xx plus checks plus 429 visible plus p95 500 p99 1000 |
| load | stages 10 25 50 VUs 7m mix | p95 400 p99 800 plus 5xx plus checks |
| stress | 25 to 200 VUs 5m30 | 5xx 2 percent plus p95 2500 p99 4000 |
| spike | instant 150 VUs | 5xx 5 percent, asserts 429s fire |
| soak | 20 VUs 10m plus leak check | p95 300 p99 600 |
| capacity | arrival 200 to 600 RPS steps | checks 95 plus 5xx 10 percent plus dropped zero, no latency gate |
| edge | 2 VUs 30s admin plus user | 5xx plus checks plus 429 shapes |
### Playwright project reference
| Project | State | Purpose |
|---|---|---|
| user | user.json | baseline plus notes plus settings |
| operator | operator.json | domain breadth without panel |
| admin | admin.json | panel plus hierarchy guards |
| superadmin | superadmin.json | delete plus impersonate-admins |
| unauthenticated | none | redirects plus 401 shapes |
| mobile | Pixel 5 plus operator | responsive plus visual |
### Guard and report reference
**Fact:** check-web-secrets exits 2 when no standalone output exists, 1 on findings in strict mode, report-only otherwise; benchmark-report reads k6 results summaries and prints the markdown table with checks, p95, p99, failed, reqs, dropped, exiting No-results on empty.
**Fact:** check-web-auth-imports exits 1 on violations and 2 when src is missing; the ESLint only-warn monkey-patch cannot fail lint so the script is the CI-enforceable gate.
**Fact:** runner-contract pins suite mapping plus explicit edge cases with no Invoke-Expression or eval, no host network mode, host-gateway mapping, canonical SUMMARY_PATH forward slashes matching summary helper plus benchmark report, secret-safe env arrays, pinned image, and package.json sh entrypoints.
### Verification commands
**Fact:** CI runs both guards plus runner-contract plus scaffold node:test suite every PR; turbo fans out test to all workspaces with passThroughEnv allowlists.
**Recommendation:** Enforce the change-to-test matrix in the PR template; add a scaffold test when adding a generator; promote secrets strict to CI fail.
**Recommendation:** Keep DOM component tests on per-spec jsdom override since web jest uses node env; keep e2e seed deterministic with truncate-first plus storage-state reuse.
### Maintenance notes
**Fact:** Untracked local runs use host ports via .env.test copy flow; docker runs use mapped test ports 5433 plus 6380 and e2e ports 5434 plus 6381 with isolated credentials.
**Recommendation:** Regenerate visual snapshots only on intentional UI change, per role plus mobile, and record the OS in the snapshot name.
