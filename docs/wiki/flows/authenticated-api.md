---
title: "Flow: Authenticated API Browser to DB"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/api-runtime.md"]
sources: ["apps/api/src/main.ts", "apps/api/src/app.module.ts", "apps/api/src/common/request-context.interceptor.ts", "apps/api/src/common/authorization.service.ts", "apps/api/src/notes/notes.service.ts", "apps/web/src/lib/server/fetch-internal.ts", "apps/web/src/lib/server/internal-api.ts", "apps/web/src/lib/server/bootstrap.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/10-ui-enforcement.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/middleware.integration.spec.ts", "apps/web/e2e/tests/notes/notes.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Authenticated API Browser to DB
> Up: ../00-INDEX.md | Depends on: INV-002, INV-003, INV-010
## Purpose
- Fact: Traces authenticated domain call from browser cookie via nginx plus web gateway plus Nest guards plus fresh-role to PG/Redis.
- Interpretation: Architecture B centralizes enforcement in API; web never queries PG directly.
- Recommendation: Copy `notes.controller` pattern for new domain endpoints; never re-resolve session mid-request.
## Diagram
```text
browser(cookie) -> nginx(api_limit) -> web fetch-internal/internal-api/bootstrap
  -> main.ts(ALS first->metrics->helmet->prefix api->ValidationPipe->CORS)
  -> ThrottlerGuard -> AuthGuard(session once) -> RequestContextInterceptor
  -> ObservabilityInterceptor(span-only) -> @Session once
  -> authorization.service(getFreshRoleRaw) -> notes.service(tx)
  -> PgBouncer/PG + Redis -> HttpExceptionFilter envelope
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Edge | nginx/nginx.conf:api_limit | cookie req -> upstream api | 429 on flood; /health/ never throttled |
| 1 | Web gateway | apps/web/src/lib/server/fetch-internal.ts:buildForwardedHeaders | cookie+XFF+UA -> forward | 5s timeout to 504; unreachable to 503 via toApiStatus |
| 2 | Domain call | apps/web/src/lib/server/internal-api.ts:callInternalApi | path -> INTERNAL_API_URL + no-store | Throws APIError preserving status for isAPIError |
| 3 | Bootstrap | apps/web/src/lib/server/bootstrap.ts:getRequestBootstrap | headers -> me-bootstrap once | React cache coalesces layout+page to 1 HTTP |
| 4 | Entry order | apps/api/src/main.ts:requestContextMiddleware | node -> ALS -> metrics -> helmet | ALS must be first; bodyParser false vendor mount owns auth bodies |
| 5 | Guards | apps/api/src/app.module.ts:ThrottlerGuard | req -> AuthGuard -> req.session | Redis blip fail-open memory; unauth 401 |
| 6 | Context copy | apps/api/src/common/request-context.interceptor.ts:RequestContextInterceptor | req.session -> ALS copy | Anonymous leaves unset; background undefined by design |
| 7 | AuthZ | apps/api/src/common/authorization.service.ts:getFreshRoleRaw | effectiveId -> PG role -> assert | Never trusts session.user.role; ALS memo collapses per-request |
| 8 | Service tx | apps/api/src/notes/notes.service.ts:enqueueSessionAudit | session+tx -> note + outbox row | Same-tx atomic; PG down rolls back both |
| 9 | Response | apps/api/src/common/http-exception.filter.ts:HttpExceptionFilter | throw -> envelope statusCode/timestamp/path | >=500 redacted; headersSent warn+end |
## Files
- Fact: `apps/api/src/main.ts` owns `requestContextMiddleware` first plus metrics plus `setGlobalPrefix('api')` plus `ValidationPipe`.
- Fact: `apps/api/src/app.module.ts` owns `ThrottlerGuard` APP_GUARD plus `RequestContextInterceptor` plus `ObservabilityInterceptor`.
- Fact: `apps/api/src/common/authorization.service.ts` owns `getFreshRoleRaw` plus ALS memo plus `session.utils:getEffectiveUserId`.
- Fact: `apps/web/src/lib/server/fetch-internal.ts` plus `internal-api.ts` plus `bootstrap.ts` own cookie forward plus coalescing.
## Failure branches
- Fact: Redis down -> throttler memory fallback bounded 5000; session falls back to PG read.
- Fact: PG down -> readiness 503 but liveness 200; domain write throws and rolls back tx.
- Fact: Stale session role -> fresh PG read recovers on next request; ban takes effect immediately.
- Fact: Worker crash -> `cluster.ts` refork with backoff; ALS is per-process per-request by construction.
## Security + observability implications
- Fact: `extractClientMeta` plus `resolveClientIp` feed audit; `normalizeRouteForMetrics` bounds route cardinality.
- Fact: `ObservabilityInterceptor` is span-only; catch-all metrics middleware captures 404/502 bypassing interceptors.
- Interpretation: Adding high-cardinality labels without normalizer blinds Alloy 64MiB plus dashboards.
- Uncertainty: FINAL-10 Q2 non-auth large-body limit with `bodyParser:false` unverified; vendor mount may not cover domain routes. See FINAL-10 Q2.
- Uncertainty: FINAL-10 Q3 order between `RequestContextInterceptor` and `ObservabilityInterceptor` unpinned; both non-mutating today. See FINAL-10 Q3.
## Linked invariants
- Recommendation: Enforced by [INV-002 Fresh Role](../invariants/02-fresh-role.md) plus [INV-003 Request Context](../invariants/03-request-context.md).
- Recommendation: UI gating split in [INV-010 UI Enforcement](../invariants/10-ui-enforcement.md); never unify me/role with me/permissions.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T1,T2,T4,T9,T10; subsystems `api-runtime` plus `rbac-rules-users` plus `web-runtime`.
