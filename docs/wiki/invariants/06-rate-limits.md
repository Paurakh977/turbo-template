---
title: "Three Rate Limit Layers No Bypass"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/redis.md"]
sources: ["nginx/nginx.conf", "packages/auth/src/server/auth.ts", "apps/api/src/app.module.ts", "apps/api/src/rate-limit/redis-throttler.storage.ts", "packages/roles/src/index.ts", "apps/api/src/rate-limit/server-action-rate-limit.service.ts"]
depends_on: ["decisions/ADR-0009-no-rate-limit-bypass.md", "decisions/ADR-0006-fail-open-throttler.md", "flows/rate-limited.md"]
guards: ["apps/api/test/integration/modules/rate-limit-thresholds.integration.spec.ts", "apps/api/test/integration/modules/rate-limit.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-006 Three Rate Limit Layers No Bypass
> Up: ../00-INDEX.md
**ID:** INV-006
## Invariant
- Fact: Three layers ordered outer-to-inner MUST stay stacked with no bypass header; 429 is expected behavior, never an error to silence.
## Why
- Fact: Bypass equals unlimited flood; skipping throttle on health breaks contract; removing zones for k6 hides production flood shape (FINAL-07 Medium-04 plus High-03).
## Code
- Fact: `nginx/nginx.conf:82-88` zones auth 300r-per-m plus api 10r-per-s plus general 30r-per-s plus conn 20; `@ratelimited` generic JSON plus Retry-After 10; `/api/auth/` passes Better Auth 429 through.
- Fact: `packages/auth/src/server/auth.ts:430-478` customRules get-session 60-per-300 plus admin 2-to-6 plus challenge 2-to-5; storage redis ternary secondary versus database.
- Fact: `apps/api/src/app.module.ts:40-51` throttler ttl plus limit via `parseThrottleInt`; `apps/api/src/rate-limit/redis-throttler.storage.ts:29-127` fail-open MEMORY_FALLBACK 5000; SCOPES `packages/roles/src/index.ts:152-162` IsIn gated.
### Folded INV-011 bare-token plus disjoint keys plus fail-open
- Fact: Session key is bare token no prefix in better-auth 1.6.29; 9 namespaces disjoint by construction bare versus verification-star versus server-action-star versus throttle-braces versus pending-underscore.
- Fact: Every layer except server-action fails open to PG or memory or no-op; server-action throws and caller decides per scope via failOpen flag.
- Fact: For sanitize-allowlist see [05-audit-planes.md](05-audit-planes.md) INV-012 pointer only; this file owns only throttle plus key posture.
## Consequences
- Fact: Floods shed at edge then auth then app with honest 429; k6 spike asserts 429 fires while 5xx stays zero.
## Naive failure mode
- Interpretation: Adding X-Bypass header or SkipThrottle on health or regex scope instead of IsIn mints unbounded `server-action:anything` keys with 1h TTL.
## Guards-tests
- Fact: Run `rate-limit-thresholds` plus e2e ratelimit plus k6 spike plus 210-to-429 health test; verify health throttled in Nest but exempt at edge.
## Related ADRs
- Recommendation: See [ADR-0009 No Bypass](../decisions/ADR-0009-no-rate-limit-bypass.md) plus [ADR-0006 Fail Open](../decisions/ADR-0006-fail-open-throttler.md).
## Related flows-subsystems
- Recommendation: Enforced in [rate-limited](../flows/rate-limited.md); owned by [redis](../subsystems/redis.md) plus nginx-edge.
- Uncertainty: FINAL-10 Q4 `active-sessions-*` belt-and-braces versus load-bearing unconfirmed; revocation correctness depends on review, see FINAL-10 Q4.
