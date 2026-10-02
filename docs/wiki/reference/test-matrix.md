---
title: "Reference: Test Matrix"
type: reference
status: stable
authority: derived
owners: ["subsystems/testing.md"]
sources: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/web/playwright.config.ts", "k6/config.js", "turbo.json", ".agent/wiki-discovery/13-testing.md"]
depends_on: ["subsystems/testing.md", "subsystems/k6-performance.md", "subsystems/api-runtime.md"]
guards: ["apps/api/test/integration/modules/health.integration.spec.ts", "scripts/check-web-secrets.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Test Matrix
> Up: ../00-INDEX.md
| Change | Required | Recommended | Expensive (compose) |
|---|---|---|---|
| domain module (Notes seam) | notes-rbac, admin-mutations, audit integration | e2e orders + rbac bypass | test profile full suite |
| auth/session/2FA/role | auth-flow, auth-session, 2fa, rbac-matrix, oauth | e2e auth | test profile |
| model/migration/pool | prisma integration, migrate gate, pool gauges | truncate-order check | test profile migrate |
| rate-limit scope/zone | rate-limit-thresholds, security-regression 210-429, redis-failure | e2e ratelimit | k6 spike (429 fire, 5xx zero) |
| observability SDK/label/alert | metrics, normalize-route, alert-rules specs | Grafana 01-06 render | monitoring profile |
| docker/env/port/profile | check-web-secrets-strict, web-imports, compose config | e2e boot + migrate DIRECT_URL + NEXT_PUBLIC rebuild test | e2e profile boot |
| audit plane/event/purge | audit-logging, audit, outbox, purgeDoneBatch, queue specs | DLQ SQL redrive dry-run | test profile |
| health/topology | health live+ready, middleware | e2e ready poll | e2e profile |
| perf/cluster/k6 threshold | performance integration, ELU/delay | k6 smoke/load/stress/soak/capacity | k6 host-run + compose local |
| security boundary | attack-surface, auth-security, jwt, links | e2e security | test + e2e profiles |
## Notes
- Fact: Jest unit+integration is gate; Playwright (seed>nginx TLS>projects) is profile-gated; k6 thresholds 5xx-only + checks.
- Fact: `test:integration:all` is unit of green; turbo tasks isolate env via passThroughEnv per suite.
- Fact: Guards `check-web-*`, `normalize-route`, `alert-rules` cited not restated; run before merge per change row.
- Uncertainty: e2e `/` vs `/api` prefix drift (FINAL-10 Q1); bodyParser 2MB vendor mount (Q2); interceptor order unpinned (Q3). See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md.
