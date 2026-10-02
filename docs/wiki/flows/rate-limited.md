---
title: "Flow: Rate Limited Edge to App"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/redis.md"]
sources: ["nginx/nginx.conf", "nginx/entrypoint.sh", "packages/auth/src/server/auth.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "apps/api/src/rate-limit/server-action-rate-limit.service.ts", "apps/api/src/rate-limit/server-action-rate-limit.controller.ts", "apps/web/src/lib/server/server-action-rate-limit.ts"]
depends_on: ["invariants/06-rate-limits.md", "invariants/07-health.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/web/e2e/tests/ratelimit/rate-limit.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Rate Limited Edge to App
> Up: ../00-INDEX.md | Depends on: INV-006, INV-007
## Purpose
- Fact: Narrates three throttle layers from nginx zones to Better Auth customRules to Nest plus server-action scopes.
- Interpretation: Each layer bounds different abuse: flood, brute-force, global budget, per-user mutations.
- Recommendation: Add new throttled action to `SERVER_ACTION_SCOPES` first; tune via env not code.
## Diagram
```text
client -> nginx(auth_limit/api_limit/general_limit+conn+@ratelimited 429)
  -> auth.ts(customRules INCR EXPIRE per-endpoint) -> Nest redis-throttler(Lua fail-open)
  -> server-action service(Lua INCR EXPIRE PTTL scope:id) -> Redis 7-alpine allkeys-lru
  web server-action-rate-limit(failOpen) -> POST /api/rate-limit/check(IsIn SCOPES)
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Edge zones | nginx/nginx.conf:limit_req_zone | ip -> auth/api/general buckets | 429 JSON Retry-After; health exempt from throttle |
| 1 | Edge tune | nginx/entrypoint.sh:render_rate | env RATE/BURST -> rendered conf | Missing env fails fast at boot not at request |
| 2 | Auth rules | packages/auth/src/server/auth.ts:customRules | endpoint -> window/max per path | Paths relative to basePath; get-session 300/m passive |
| 3 | Nest budget | apps/api/src/rate-limit/redis-throttler.storage.ts:RedisThrottlerStorage | req -> Lua shared counter | Redis blip fail-open memory fallback bounded 5000 |
| 4 | Action scope | apps/api/src/rate-limit/server-action-rate-limit.service.ts:checkLimit | scope+id -> allowed+remaining | Unknown scope 400 via IsIn; session-derived id prevents burn |
| 5 | Action gate | apps/api/src/rate-limit/server-action-rate-limit.controller.ts:check | POST check -> decision | Validates SCOPES allowlist before Redis touch |
| 6 | Web caller | apps/web/src/lib/server/server-action-rate-limit.ts:callInternalApi | Server Action -> API check | Fail-open flag preserves UX on API 503/504 |
| 7 | Store | packages/auth/src/server/pending-storage.ts:inventory | keys -> TTL inventory comment | Bare token 7d; pending 15-30s GETDEL; no collisions |
## Files
- Fact: `nginx/nginx.conf:82-88` zones plus `209/245/281` locations plus `@ratelimited` 429 shape.
- Fact: `packages/auth/src/server/auth.ts:435-478` `customRules` per-endpoint plus `secondaryStorage` INCR EXPIRE.
- Fact: `apps/api/src/rate-limit/redis-throttler.storage.ts` Lua atomic plus fail-open memory fallback.
- Fact: `packages/roles/src/index.ts` `SERVER_ACTION_SCOPES` closed allowlist plus `IsIn` guard in controller.
## Failure branches
- Fact: Redis down -> Nest memory fallback allows with counter; server-action defaults closed to deny.
- Fact: Flood -> edge 429 before app cost; brute-force -> auth 429 with 3/60s on sign-up challenge.
- Fact: Unknown scope -> 400 without Redis increment; health probe stays throttled 210-hit to 429 by design.
- Fact: No bypass header exists; `SkipThrottle` on health is forbidden and lint-checked.
## Security + observability implications
- Fact: Disjoint keys prevent collisions across flood/brute/budget/mutation layers.
- Fact: `recordRateLimitHit` labels normalized path; k6 asserts 429 expected with 5xx zero.
- Interpretation: Removing a zone for load-test convenience re-opens flood globally; tune rates instead.
- Fact: Fail-open fallback counters `throttler_redis_errors` must alert on prolonged Redis outage window.
## Linked invariants
- Recommendation: Enforced by [INV-006 Rate Limits](../invariants/06-rate-limits.md) plus health split in [INV-007 Health](../invariants/07-health.md).
- Recommendation: No-bypass rule is ADR-0009; fail-open memory bound is ADR-0006; do not relax without ADR.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T5,T9; subsystems `redis` plus `nginx-edge` plus `k6-performance`.
- Fact: Leftmost X-Forwarded-For never trusted; resolver uses trusted proxy CIDR plus rightmost untrusted hop.
- Fact: Burst tuning lives in compose NGINX_* per profile; code change is not the throttle knob.
