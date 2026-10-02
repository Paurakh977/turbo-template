---
title: "Reference: Rate Limit Matrix"
type: reference
status: stable
authority: derived
owners: ["subsystems/redis.md"]
sources: ["nginx/nginx.conf", "packages/auth/src/server/auth.ts", "apps/api/src/app.module.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "packages/roles/src/index.ts", "apps/api/src/health/health.controller.ts"]
depends_on: ["invariants/06-rate-limits.md", "subsystems/redis.md", "subsystems/nginx-edge.md", "flows/rate-limited.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/api/test/integration/modules/security-regression.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Reference: Rate Limit Matrix
> Up: ../00-INDEX.md
> Note: nginx.conf holds PLACEHOLDERs; effective rates come from NGINX_* env via entrypoint.sh (defaults: auth 300r/m, api 10r/s, general 30r/s). Table shows defaults.
| Layer | Scope | Limit | Key | 429 shape |
|---|---|---|---|---|
| nginx auth_limit | /api/auth/ | 300r/m burst10 | $binary_remote_addr | 429 JSON @ratelimited |
| nginx api_limit | /api/ | 10r/s burst20 nodelay | $binary_remote_addr | 429 JSON @ratelimited |
| nginx general_limit | /, /collect | 30r/s burst50 nodelay | $binary_remote_addr | 429 JSON @ratelimited |
| nginx conn_limit | server all | 20 concurrent | $binary_remote_addr conn | 429 conn |
| BetterAuth global | all auth paths | 60s/20 | IP+path secondaryStorage/database | 429 BetterAuth JSON |
| BetterAuth passive | /get-session | 60s/300 | IP+path | 429 BetterAuth JSON |
| BetterAuth admin-read | /list-accounts,/admin/list-users 60; /list-user-sessions,/has-permission 30 | 60s/60 or 30 | IP+path | 429 BetterAuth JSON |
| BetterAuth admin-mutate | /admin/set-role,/revoke-* 5; /ban,/unban,/impersonate,/create,/set-password 3; /remove-user 2; /stop-impersonating 6 | 60s/2-6 | IP+path | 429 BetterAuth JSON |
| BetterAuth challenge | /sign-in,/change-password,/reset-password 5; /sign-up,/request-reset,/send-verify,/send-otp,/change-email 3; /verify-totp,/verify-otp,/verify-backup 10s/3 | 60s or 10s/3-5 | IP+path | 429 BetterAuth JSON |
| BetterAuth destructive | /delete-user | 60s/2 | IP+path | 429 BetterAuth JSON |
| Nest global throttler | all api incl /api/health/* throttled | 60s/200 | throttle:{tracker}:hits Redis | 429 Nest JSON, fail-open memory 5000 |
| Server-action Lua | 9 SCOPES notes:*, settings:*, admin:resend, dashboard:fresh-role | per-scope windowMs+max | server-action:<scope>:<id> | 429+retryAfter PTTL; 400 unknown scope |
## Notes
- Fact: Sources nginx.conf:82-88,244-281; auth.ts:430-477; app.module.ts:156-170; roles/index.ts:152-162.
- Fact: No bypass header, no SkipThrottle on health; 210 sequential health hits must yield 429 (contracted).
- Fact: Nginx empty-key = unlimited, so no client-controlled key; k6 treats 429 as expected, never bypass.
- Fact: Redis blip = fail-open (memory window); availability preserved, alert on warn log.
- Fact: New action = SCOPES first, then customRules/throttler/Lua; unknown scope 400 protects key-space.
