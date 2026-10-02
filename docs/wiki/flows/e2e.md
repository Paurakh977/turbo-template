---
title: "Flow: E2E Seed to Playwright Report"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/testing.md"]
sources: ["apps/web/e2e/scripts/seed.ts", "apps/web/playwright.config.ts", "apps/web/src/proxy.ts", "apps/web/e2e/tests/auth/auth.spec.ts", "apps/web/e2e/helpers/database.helper.ts", "apps/web/e2e/config/users.ts"]
depends_on: ["invariants/07-health.md", "invariants/09-env.md"]
guards: ["apps/web/e2e/tests/health/health.spec.ts", "apps/web/e2e/tests/rbac/permissions.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: E2E Seed to Playwright Report
> Up: ../00-INDEX.md | Depends on: INV-007, INV-009
## Purpose
- Fact: Covers deterministic seed through nginx TLS to Playwright projects plus storage states to HTML report.
- Interpretation: Role must pin before sign-in or Redis-cached session hides admin and bounces to dashboard.
- Recommendation: Keep 3-pass seed order; run e2e profile isolated ports 5434/6381/8443.
## Diagram
```text
seed.ts(TRUNCATE+signUpWithRetry+role UPDATE before sign-in+storageState)
  -> playwright.config(6 projects user/operator/admin/superAdmin/unauth/mobile)
  -> helpers(auth/database/redis/audit/api)+config(users/routes/env)
  -> nginx https 8443 real TLS -> api-e2e+web-e2e+postgres-e2e+redis-e2e
  -> tests(auth/notes/admin/audit/rbac/ratelimit/proxy/security/health)
  -> html report + trace on retry
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Seed wipe | apps/web/e2e/scripts/seed.ts:TRUNCATE | tables -> RESTART IDENTITY CASCADE | Volume persists so TRUNCATE required; flushAll clears Redis buckets |
| 1 | Seed users | apps/web/e2e/scripts/seed.ts:signUpWithRetry | signup -> 4 tries + flush retry | Signup 429 handled by wait+retry so seed stays deterministic |
| 2 | Role pin | apps/web/e2e/scripts/seed.ts:UPDATE role | user -> verified+role before sign-in | Role after sign-in hides admin until invalidate; must stay before |
| 3 | Projects | apps/web/playwright.config.ts:projects | base -> 6 storageState roles | Workers 1 fullyParallel false; ipv4first avoids localhost flake |
| 4 | Edge TLS | apps/web/src/proxy.ts:proxy | https 8443 -> api/web upstreams | Real TLS exercises XFF+CSP+traceparent; host-only misses nginx hop |
| 5 | Helpers | apps/web/e2e/helpers/database.helper.ts:TRUNCATE | test -> wipe safe tables only | Never wipes seeded users between tests; per-test tables only |
| 6 | Suites | apps/web/e2e/tests/auth/auth.spec.ts:auth | storageState -> 15 specs | Rbac 403 plus proxy plus health plus a11y prove enforced not hidden |
| 7 | Report | apps/web/playwright.config.ts:reporter | run -> html+list+trace retry | Trace on retry only keeps artifacts bounded under parallel flake |
## Files
- Fact: `apps/web/e2e/scripts/seed.ts:86-151` owns flush plus TRUNCATE plus retry plus `buildStorageState` writeFile.
- Fact: `apps/web/playwright.config.ts:48-71` owns 6 projects plus globalSetup/teardown plus ipv4first plus 8443 baseURL.
- Fact: `apps/web/e2e/helpers/*` plus `e2e/config/users.ts` plus `routes.ts` plus `playwright.env.ts` own fixtures.
- Fact: `apps/web/src/proxy.ts` owns edge proxy exercised by proxy plus security plus health specs.
## Failure branches
- Fact: Seed 429 -> flush Redis instantly and retry; signup window exhausted no longer flakes suite.
- Fact: Parallel workers -> config forces 1 worker; flake under parallel remains known limit.
- Fact: API down -> readiness 503 surfaces in health spec; liveness 200 keeps container from restart loop.
- Fact: Stale volume -> TRUNCATE plus flush required; fresh compose without wipe reuses old roles.
## Security + observability implications
- Fact: Seed admin creds from `.env.e2e` isolated compose; never reuse prod secrets or prod ports.
- Fact: Health specs assert live no-deps 200 plus ready Redis+PG 503 shape plus throttled behavior.
- Interpretation: Green e2e without TLS profile misses edge headers; gate releases on e2e profile not host run.
- Uncertainty: FINAL-10 Q1 `app.e2e-spec` `/` versus `/api` prefix drift may give false confidence; run stub suite and fix or delete. See FINAL-10 Q1.
## Linked invariants
- Recommendation: Enforced by [INV-007 Health](../invariants/07-health.md) live versus ready plus [INV-009 Env](../invariants/09-env.md) single source.
- Recommendation: Env ownership plus ports topology in reference docs; e2e uses `.env.e2e` plus 5434/6381/8443 isolation.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T7; subsystems `testing` plus `docker-environments` plus `nginx-edge`.
