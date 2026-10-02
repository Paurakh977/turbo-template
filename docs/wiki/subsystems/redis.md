---
title: "Subsystem: Redis (Keys, Three-Layer Limits, Fail-Open)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/redis.md"]
sources: ["packages/auth/src/server/auth.ts", "apps/api/src/app.module.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "packages/roles/src/index.ts", "packages/auth/src/server/infra/redis.ts", "packages/auth/src/server/pending-storage.ts"]
depends_on: ["invariants/06-rate-limits.md"]
guards: ["apps/api/src/rate-limit/redis-throttler.storage.spec.ts", "apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Redis (Keys, Three-Layer Limits, Fail-Open)
> Up: ../00-INDEX.md | Depends on: INV-06 (rate-limits). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `packages/auth/src/server/auth.ts:430-478` (Better Auth customRules) plus `apps/api/src/app.module.ts:156-199` (Nest ThrottlerModule) plus `apps/api/src/rate-limit/redis-throttler.storage.ts:29-127` (fail-open storage).
**Fact:** Key owners are `packages/auth/src/server/infra/redis.ts` (secondaryStorage client) plus `pending-storage.ts:252-318` (bare-token plus pending plus active-sessions inventory) plus `packages/roles/src/index.ts:152-162` SCOPES allowlist.
**Recommendation:** Change any key, limit, or scope only in these files; mirror scope additions in web action helper plus controller IsIn same PR.
## 2. Runtime
**Fact:** Three layers in order are nginx per-IP zones (edge flood) then Better Auth per-endpoint per-user/IP (auth.ts customRules) then Nest global throttler plus per-scope server-action limits (Redis-backed).
**Fact:** Better Auth `secondaryStorage` uses bare-token keys (no `session:` prefix) written on sign-in, read on every getSession, deleted on sign-out plus revoke (`pending-storage.ts:252-298`).
**Fact:** Nest `RedisThrottlerStorage` wraps `ThrottlerStorageRedisService` with Redis primary and in-memory fallback of 5000 keys on blip (`redis-throttler.storage.ts:82-127`).
**Interpretation:** Layering is defense-in-depth: edge catches floods, auth catches credential abuse, app catches scoped action abuse; no layer bypasses another.
## 3. Public API
**Fact:** App code touches Redis only via `redis` client export, `secondaryStorage` wrapper, `RedisThrottlerStorage` increment, and `SERVER_ACTION_SCOPES` allowlist check.
| Symbol | Contract | Source |
|---|---|---|
| secondaryStorage | get/set/delete plus GETDEL atomic | packages/auth/src/server/auth.ts:174-287 |
| RedisThrottlerStorage | increment with fail-open memory | apps/api/src/rate-limit/redis-throttler.storage.ts:48-107 |
| SERVER_ACTION_SCOPES | 9 allowlisted scopes, exact match | packages/roles/src/index.ts:152-162 |
**Fact:** Nine scopes are notes create/update/delete plus settings four plus admin resend-verification plus dashboard fresh-role; unknown scope is 400, never mints key.
## 4. Dependency direction
**Fact:** Allowed: auth.ts into redis client; throttler storage into redis; server-action service into SCOPES plus storage; pending-storage into redis with GETDEL.
**Fact:** Forbidden: web tier direct Redis import (gateway-only); domain service branching on queue success; client-set actor markers without sanitize.
| Check | Grep |
|---|---|
| No web redis | rg -n "ioredis|redis" apps/web/src, expect only server-action helper |
| No bypass header | rg -n "X-Bypass|SkipThrottle" nginx/nginx.conf apps/api/src/health, expect health has none |
| Scope allowlist first | rg -n "SERVER_ACTION_SCOPES" packages/roles/src apps/api/src/rate-limit, expect both |
## 5. Security posture
**Fact:** Bare-token keys mean possession equals session; TTL equals SESSION_EXPIRES_IN 7d; revocation deletes bare token plus active-sessions entry (see Q4 note).
**Fact:** Server-action keys are `server-action:<scope>:<id>` allowlisted, so unknown scope cannot create unbounded keyspace (IsIn guard in controller:16).
**Fact:** Throttle keys are disjoint from session keys; auth rate keys use pending prefix with 15-30s TTL via GETDEL, never colliding with throttle buckets.
## 6. Failure modes
**Fact:** Redis blip fails open to per-instance memory window (5000 keys, TTL-preserved) with warn log, never 500-all; recovers to Redis on next increment.
**Fact:** SecondaryStorage get/set/delete failures fall back to PG with hit/miss/fallback counters (`auth.ts:180-287` meters) plus error log, never throwing to caller.
**Fact:** GETDEL failure path logs and falls back; pending OTP flows retry via resend scope rather than wedging on missing key.
**Fact:** PG down while Redis up still serves cached sessions but fresh-role checks fail closed at DB read (see rbac subsystem, not repeated here).
## 7. Performance
**Fact:** Throttler uses Lua increment with TTL in Redis (single RTT); memory fallback uses Map with timers unrefd so SIGTERM is not delayed.
**Fact:** Session reads are one Redis GET per getSession plus PG fallback on miss; hierarchy notes extra GETs plus 2x findUnique (see hierarchy.ts:29 comment).
**Fact:** 210 sequential health hits must 429 (security-regression contract); k6 single-IP runs open NGINX plus RATE plus THROTTLE via .env.k6 so backend is stressed.
**Fact:** Key cardinality bounded by SCOPES allowlist (9) times user/action IDs; no free-form scope string ever reaches Redis key construction.
## 8. Config/Env
**Fact:** `REDIS_URL` from `.env.example:97` (localhost) vs compose service hostname; `REDIS_PREFIX` isolates int-test keys in integration profile.
**Fact:** `RATE_LIMIT_WINDOW 60` plus `RATE_LIMIT_MAX 100` tune Better Auth global cap; `THROTTLE_TTL_MS 60000` plus `THROTTLE_LIMIT 200` tune Nest guard (see .env.example:160-169).
**Fact:** Compose passes tuning as empty-means-fallback (`parseIntEnv` plus `parseThrottleInt` digits-only); k6 overlay sets 2M/60s to reach backend (see .env.k6.example:54-57).
## 9. Testing/verification
**Fact:** `redis-throttler.storage.spec.ts` covers increment plus TTL plus fail-open fallback plus memory eviction at 5000; run `pnpm --filter api test`.
**Fact:** `rate-limit-thresholds.integration.spec.ts` asserts 429 fires and 5xx stays zero; `security-regression` asserts 210 health hits 429.
**Fact:** `pending-storage.spec.ts` plus `pending-storage.redis.spec.ts` cover bare-token shape plus GETDEL atomicity plus TTL sweep behavior.
**Recommendation:** After limit or scope change run `rate-limit-thresholds` plus `e2e ratelimit` plus `k6:smoke` if hot path before merge.
## 10. Extension pointer
**Recommendation:** Add rate-limited action by adding SCOPES entry first, then Better Auth customRule, then throttler scope, then nginx zone, then k6 scenario same PR.
**Recommendation:** Add Redis key only with Owner plus TTL plus fail-behavior row in reference/redis-keys.md (future) plus spec covering miss plus fallback.
**Recommendation:** Follow workflows/add-rate-limited-action.md (future) for edge-to-app checklist plus 429 visibility gates.
## 11. AI-guidance
MUST: keep SCOPES-first ordering; keep IsIn validation exact; keep bare-token shape (no session prefix); keep GETDEL for pending; keep fail-open bounded 5000.
MUST: keep no-bypass (no X-Bypass header, no SkipThrottle on health); keep 429 as expected in thresholds, only 5xx fails; keep throttle keys disjoint.
MUST-NOT: add free-form scope string from web without allowlist; cache roles in Redis with TTL (reopens stale elevation); sum depth gauge across workers.
MUST-NOT: gate compose depends_on on Redis ready alone; web must never import ioredis or pg directly (Arch-B violation).
## 12. Common mistakes
**Interpretation:** Adding X-Bypass-Rate-Limit header for k6 convenience maps to empty limit_req key (unlimited per nginx docs) and disables flood protection globally.
**Interpretation:** Trusting session.user.role to save Redis GET reopens stale elevation until 7d TTL; use fresh PG role via getFreshRoleRaw instead.
**Interpretation:** Caching roles module-level with TTL recreates elevation globally including banned users; Redis session cache is not a role cache.
**Interpretation:** Summing audit_queue depth gauge across workers double-counts; alert on max not sum (see observability, not repeated here).
## 13. Related
Invariants: INV-06 rate-limits (3 layers plus no bypass plus 429 expected; rules not repeated). Flows: flows/rate-limited.md plus flows/authenticated-api.md (future). Subsystems: nginx-edge.md plus auth-better-auth.md plus api-runtime.md. Workflows: add-rate-limited-action.md plus change-auth.md (future). ADRs: ADR-0006 fail-open plus ADR-0009 no-bypass (future).
## 14. Refs
packages/auth/src/server/auth.ts, packages/auth/src/server/infra/redis.ts, packages/auth/src/server/pending-storage.ts, apps/api/src/app.module.ts, apps/api/src/rate-limit/redis-throttler.storage.ts, apps/api/src/rate-limit/server-action-rate-limit.controller.ts, apps/api/src/rate-limit/server-action-rate-limit.service.ts, packages/roles/src/index.ts, nginx/nginx.conf, k6/config.js, k6/scenarios/rate-limit-flow.js.
> **Uncertainty:** active-sessions-key deletion load-bearing vs belt-and-braces is unverified; reads filter expired so deletion may be redundant. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4; do not assume key absence equals revoked until Better Auth 1.6.29 read-path review plus Redis-absence test lands.
| Key pattern | Owner | TTL | Source |
|---|---|---|---|
| bare-token | secondaryStorage | SESSION_EXPIRES_IN 7d | auth.ts:174-287 |
| active-sessions-userId | invalidation helper | session TTL | pending-storage.ts:285-318 |
| pending-star | OTP plus 2FA | 15-30s GETDEL | pending-storage.ts:120-252 |
| server-action-scope-id | server-action limiter | scope window | roles/index.ts:152-162 |
| throttle-record | Nest throttler | THROTTLE_TTL_MS | redis-throttler.storage.ts:82-107 |
**Fact:** Key taxonomy source is pending-storage inventory plus auth.ts plus throttler plus SCOPES; prose here is descriptive and code wins.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
### Throttle tuning matrix
| Layer | Scope | Prod limit | k6 limit | 429 shape |
|---|---|---|---|---|
| nginx auth | per-IP zone | 300r/m burst 10 | 20000r/m burst 2000 | generic JSON plus Retry-After |
| Better Auth | get-session plus admin | customRules 2-300 | 2M per 60s | Better Auth JSON passthrough |
| Nest guard | global per-IP | 200 per 60s | 2M per 60s | Nest 429 envelope |
### Fail-open ladder
| Condition | Behavior | Metric |
|---|---|---|
| Redis up | Lua increment, TTL set | throttle hits counted |
| Redis blip | memory Map fallback, 5000 cap | warn log plus counter |
| Redis prolonged | permissive window, alert fires | BacklogHigh plus DLQ watch |
| PG down | session fallback limited, role fails closed | ready 503, live 200 |
**Fact:** Fail-open prefers availability over strictness per ADR-0006 (future); prolonged outage needs permissive-window alert, not silent allow.
**Recommendation:** Never add fail-closed 500 on Redis blip without ADR; bounded memory plus TTL preserves backpressure while staying up.
**Fact:** Code wins over wiki; throttler storage plus auth.ts win over prose per authority model.
**Recommendation:** Touching keys, limits, or scopes MUST update reference/redis-keys.md plus rate-limit-matrix.md same PR (future).
### Verification commands
**Fact:** Run pnpm --filter api test for unit plus test:integration -t rate-limit-thresholds for 429 contract plus security-regression for 210-hit health.
**Recommendation:** Run k6 smoke plus spike for 429 visibility before raising limits; attach benchmark-report.mjs output to limit-change PRs.
**Fact:** Do not read whole wiki for limit change; follow task route T5 rate-limit bundle in order per 00-INDEX (future).
**Fact:** SecondaryStorage meters hits plus misses plus fallbacks; use them to distinguish cache efficacy from outage fallback in dashboards.
**Recommendation:** Keep timers unrefd in memory fallback so SIGTERM drains in 20s inside 30s grace; verify via debug-prod triage.
**Interpretation:** Adding per-route SkipThrottle to quiet 429s in tests hides flood signal; tune rates via env instead, never bypass.
**Fact:** SCOPES list length is 9 today; length change must fail controller spec first (WEB_TIER_SCOPES mirror) then pass after both updated.
**Recommendation:** Keep web scope strings exact (notes:create-note not notes:create); typo is 400 by design, not silent allow.
**Fact:** Redis prefix REDIS_PREFIX isolates test keys; never share prod prefix with integration or e2e or keys collide.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
