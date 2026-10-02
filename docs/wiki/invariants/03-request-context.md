---
title: "Request Context Per Request Only"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/api-runtime.md"]
sources: ["apps/api/src/common/request-context.ts", "apps/api/src/common/request-context.interceptor.ts", "apps/api/src/common/session.utils.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/common/client-meta.ts", "apps/api/src/main.ts"]
depends_on: ["decisions/ADR-0004-fresh-role-not-snapshot.md", "flows/authenticated-api.md"]
guards: ["apps/api/src/common/request-context.spec.ts", "apps/api/test/integration/modules/middleware.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-003 Request Context Per Request Only
> Up: ../00-INDEX.md
**ID:** INV-003
## Invariant
- Fact: ALS store MUST live per request only, populated once from settled session; background work MUST capture plain data at emit and never read ALS.
## Why
- Fact: Workers read undefined by design or pin request refs and shift attribution; double `getSession` doubles Redis plus PG cost and splits impersonation identity (FINAL-07 High-01 plus High-04).
## Code
- Fact: `apps/api/src/common/request-context.ts` fresh store per `requestContextMiddleware` first in `apps/api/src/main.ts:43`; `request-context.interceptor.ts:26-48` copies `session` to ALS read-only after guards.
- Fact: `apps/api/src/common/session.utils.ts` `getEffectiveUserId` plus `getImpersonatedBy`; `apps/api/src/common/audit-writer.ts:62-86` `buildAuditRowData` captures values at emit.
- Fact: `apps/api/src/common/client-meta.ts:17-27` `extractClientMeta` reads `req.ip` plus user-agent once per request for audit attribution.
## Consequences
- Fact: Controllers calling `@Session()` once stay consistent; pollers and Better Auth background tasks stay attribution-correct without request refs.
## Naive failure mode
- Interpretation: Calling `getRequestContext()` in `audit-queue.service.ts` poller or storing session object in queue wedges attribution to undefined or stale principal.
- Interpretation: Adding `@UseGuards(AuthGuard)` locally duplicates global APP_GUARD and runs `getSession` twice per request.
## Guards-tests
- Fact: Run `request-context.spec` plus `middleware` integration; grep must show no local `UseGuards(AuthGuard)` on notes plus audit plus rate-limit controllers.
- Fact: For audit planes see [05-audit-planes.md](05-audit-planes.md) INV-005 pointer only; this file owns only ALS lifecycle.
## Related ADRs
- Recommendation: See [ADR-0004 Fresh Role](../decisions/ADR-0004-fresh-role-not-snapshot.md) for ALS-memoized fresh read rationale.
## Related flows-subsystems
- Recommendation: Enforced in [authenticated-api](../flows/authenticated-api.md) plus audit flow; owned by [api-runtime](../subsystems/api-runtime.md).
- Fact: `apps/api/src/app.module.ts:193-207` registers global ThrottlerGuard then RequestContextInterceptor in that order; vendor AuthGuard settles `req.session` before interceptor copies.
- Fact: For fresh-role verdicts see [02-fresh-role.md](02-fresh-role.md) INV-002 pointer only; never branch on ALS-cached display role.
- Fact: Timers in queue and health use `unref` so per-request stores garbage-collect after response without keeping loop hot.
