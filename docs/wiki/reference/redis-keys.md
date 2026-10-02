---
title: "Reference: Redis Keys"
type: reference
status: stable
authority: derived
owners: ["subsystems/redis.md"]
sources: ["packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/auth.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "apps/api/src/rate-limit/server-action-rate-limit.service.ts", "packages/roles/src/index.ts", "packages/auth/src/server/infra/redis.ts"]
depends_on: ["invariants/06-rate-limits.md", "subsystems/redis.md", "subsystems/auth-better-auth.md"]
guards: ["packages/auth/src/server/pending-storage.redis.spec.ts", "apps/api/test/integration/modules/redis-failure.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Redis Keys
> Up: ../00-INDEX.md
| Key | Owner | TTL | Fail behavior | Source |
|---|---|---|---|---|
| `<sessionToken>` bare | BetterAuth secondaryStorage | SESSION_EXPIRES_IN 7d | miss=PG fallback, fail-open | auth.ts:174-225 + pending-storage.ts:255-257 |
| `active-sessions-<userId>` | BetterAuth internal-adapter | session TTL | stale tolerated, DEL on invalidate | pending-storage.ts:258-263,303 |
| `verification:*` | BetterAuth OTP/reset/email | 1h reset, 24h verify, OTP min | GETDEL atomic, no app delete | pending-storage.ts:266-268 |
| rate-limit counters | BetterAuth rateLimit | per-window (60s/10s) | expire naturally, never DEL | pending-storage.ts:269-270 + auth.ts:430-477 |
| `throttle:{tracker:name}:hits\|:blocked` | Nest throttler @nest-lab | THROTTLE_TTL_MS 60s | fail-open memory 5000 keys | redis-throttler.storage.ts:29-31,46 |
| `server-action:<scope>:<id>` | ServerActionRateLimit Lua | per-scope windowMs | 400 unknown scope, no delete | server-action-rate-limit.service.ts:33 + roles/index.ts:152-162 |
| `pending_deletion:<userId>` | pending-storage before/after | 30s PX + in-mem | GETDEL + sweep fallback | pending-storage.ts:37,107 |
| `pending_user_update:<userId>` | pending-storage | 30s PX + in-mem | GETDEL + sweep fallback | pending-storage.ts:175 |
| `pending_stop_impersonation:<userId>` | pending-storage | 15s PX + in-mem | GETDEL + sweep fallback | pending-storage.ts:218 |
## Notes
- Fact: No `session:<token>` prefix, no `user:<id>` row cache; bare token is exact secondaryStorage shape.
- Fact: `invalidateUserCache` DELs bare tokens + `active-sessions-*` in one pipeline before/after mutation.
- Fact: Throttler and BetterAuth and server-action keys are disjoint by construction; never KEYS-star in prod.
- Fact: Redis blip = fail-open (session PG fallback, throttler memory, rate increment 0=allow); alert, not 500.
- Uncertainty: `active-sessions-*` load-bearing vs belt-and-braces (FINAL-10 Q4); in-process maps TTL/sweep (Q8). See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md.
