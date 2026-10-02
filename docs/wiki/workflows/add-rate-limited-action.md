---
title: "Workflow: Add Rate-Limited Action"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/redis.md"]
sources: ["packages/roles/src/index.ts", "nginx/nginx.conf", "nginx/entrypoint.sh", "packages/auth/src/server/auth.ts", "apps/api/src/app.module.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "apps/api/src/rate-limit/server-action-rate-limit.service.ts", "apps/api/src/rate-limit/server-action-rate-limit.controller.ts", "k6/config.js"]
depends_on: ["invariants/06-rate-limits.md", "invariants/07-health.md", "flows/rate-limited.md", "subsystems/redis.md", "subsystems/nginx-edge.md", "subsystems/k6-performance.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/web/e2e/tests/ratelimit/rate-limit.spec.ts", "apps/api/src/common/observability/normalize-route.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Add Rate-Limited Action
> Up: ../00-INDEX.md | Use when: new throttle scope from edge zone to app Lua. Route: T5.
## Purpose
- Fact: Adds one throttle scope across nginx plus Better Auth plus Nest plus server-action Lua with 429 expected.
- Interpretation: SCOPES allowlist is the contract; zones plus rules plus throttler enforce it at three layers.
- Recommendation: Define SCOPES first, then edge, then app, then web string, then k6 proof in that order.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T5 and confirm Required order before diff.
- [ ] Read `../invariants/06-rate-limits.md` three layers plus no bypass plus 429 expected.
- [ ] Read `../invariants/07-health.md` live versus ready plus health stays throttled.
- [ ] Read `../flows/rate-limited.md` nginx to customRules to throttler to SCOPES narrative.
- [ ] Read `../subsystems/redis.md` plus `nginx-edge.md` plus `k6-performance.md`.
- Fact: Adding a bypass header disables all nginx limits because empty keys are uncounted by design.
## Steps checklist
- [ ] 1. Add SCOPES entry in `packages/roles/src/index.ts` with scope string plus window plus max.
- [ ] 2. Add nginx zone in `nginx/nginx.conf` plus burst plus `entrypoint.sh` env mapping plus compose `NGINX_*`.
- [ ] 3. Add `customRules` in `packages/auth/src/server/auth.ts` for the scope with key plus limit.
- [ ] 4. Confirm `apps/api/src/app.module.ts` ThrottlerModule 60000 slash 200 plus `redis-throttler.storage.ts` fail-open.
- [ ] 5. Add Lua in `server-action.service.ts` plus `IsIn` guard in `server-action.controller.ts` with exact scope string.
- [ ] 6. Add web call site with exact scope string match; typo fails closed by allowlist.
- [ ] 7. Set `server-action-rate-limit.ts` helper mapping for the web action trio timing.
- [ ] 8. Add `rate-limit-thresholds` case plus e2e `ratelimit` case plus k6 thresholds for the scope.
- [ ] 9. Verify `normalize-route` stays green and health endpoint has no `SkipThrottle`.
## Commands
```sh
pnpm --filter api test:integration -- -t "rate-limit-thresholds"
pnpm --filter web test:e2e -- -g "ratelimit"
pnpm k6:smoke
pnpm k6:spike
```
- Fact: `k6:smoke` proves 429 fires; `k6:spike` proves 5xx stays zero under burst.
- Fact: Never gate k6 on raw `http_req_failed` because 429 is expected and counted there.
## Files-areas
| Area | Paths |
|---|---|
| Contract | `packages/roles/src/index.ts` SCOPES allowlist |
| Edge | `nginx/nginx.conf` zones plus `entrypoint.sh` plus compose `NGINX_*` |
| Auth | `packages/auth/src/server/auth.ts:430-478` customRules |
| App | `app.module.ts` throttler plus `redis-throttler.storage.ts` Lua fallback |
| Action | `rate-limit/server-action-rate-limit.*` service plus controller plus rate-limit helper |
## Architectural gates
- Fact: No bypass header and no `SkipThrottle` on health; health 210-hit must still 429.
- Fact: Three layers all present for the new scope; missing one layer fails review.
- Fact: Fail-open bounded memory 5000 on Redis blip; never fail-closed 500 for all traffic.
- Fact: 429 shapes consistent per layer; 5xx stays zero in smoke plus spike.
## Tests
- Fact: Required `rate-limit-thresholds` plus e2e `ratelimit` plus `normalize-route` green.
- Fact: Required k6 smoke plus spike with 429 visibility report and 5xx-only gate.
- Fact: Required grep no `SkipThrottle` in `health.controller.ts:26-36`.
## Documentation updates
- Fact: Same PR updates `subsystems/redis.md` plus `nginx-edge.md` for zone plus rule rows.
- Fact: Same PR updates `reference/rate-limit-matrix.md` plus `reference/redis-keys.md` for scope plus key.
- Fact: Bump `updated` plus run link lint; never paste full nginx conf into docs.
## Verification
- [ ] Thresholds plus e2e ratelimit green on default config with real Redis.
- [ ] k6 smoke plus spike show 429 fire with 5xx zero plus checks above 99 percent.
- [ ] No bypass string in diff; health still throttled under 210-hit probe.
- [ ] `git status --short` shows only scope plus zone plus rule plus spec plus docs paths.
## Failure-recovery
- Fact: Over-tight limit maps to tune rates via env, never add bypass header for load tests.
- Fact: Redis outage maps to bounded memory fallback plus alert; permissive window is expected.
- Fact: Scope typo maps to fix web string to exact SCOPES key; allowlist fails closed safely.
- Uncertainty: FINAL-10 Q1 e2e prefix drift may hide ratelimit 429 shape; confirm stub suite, see FINAL-10 Q1.
## Related
- Fact: Up `../00-INDEX.md`; routes T5; enforced by INV-006 plus INV-007.
- Recommendation: Key taxonomy in `../reference/redis-keys.md`; matrix in `../reference/rate-limit-matrix.md`.
- Recommendation: Perf ceiling work stays in research, never as workflow gate.
