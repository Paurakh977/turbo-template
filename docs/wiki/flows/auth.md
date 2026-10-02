---
title: "Flow: Auth Login Session 2FA Impersonation"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/auth-better-auth.md"]
sources: ["packages/auth/src/server/auth.ts", "packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "apps/web/src/lib/auth/auth-client.ts", "apps/web/src/lib/server/auth-http.ts"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/06-rate-limits.md"]
guards: ["apps/api/test/integration/modules/auth-flow.integration.spec.ts", "apps/api/test/integration/modules/2fa.integration.spec.ts", "apps/web/e2e/tests/auth/auth.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Auth Login Session 2FA Impersonation
> Up: ../00-INDEX.md | Depends on: INV-001, INV-002, INV-003, INV-006
## Purpose
- Fact: Describes unauthenticated browser login through to session cookie issue, 2FA verify, and admin impersonation lifecycle.
- Interpretation: All web auth goes via HTTP gateways; web never imports `{ auth }` or `{ db }` directly.
- Recommendation: Read before changing `auth.ts`, plugins, hooks, or `auth-client.ts` classification.
## Diagram
```text
browser(auth-client) -> nginx(auth_limit) -> main.ts(AuthModule mount)
  -> auth.ts(betterAuth+customRules+secondaryStorage) -> PG(Session)+Redis(bare token)
  -> nextCookies Set-Cookie -> browser jar
sign-in 2FA: partial session -> verify-totp/otp/backup -> full session
admin: set-role/ban/impersonate -> auditLogPlugin(before guard+stash/after write)
  -> databaseHooks(session hooks) -> invalidateUserCache
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Browser client | apps/web/src/lib/auth/auth-client.ts:createAuthClient | form -> POST /api/auth/* | 429 classified passive/challenge/handled/destructive |
| 1 | Edge throttle | nginx/nginx.conf:auth_limit | client -> upstream api | 429 JSON Retry-After on flood |
| 2 | API entry | apps/api/src/main.ts:requestContextMiddleware | req -> ALS store + metrics | ALS must be first; auth mount bypasses interceptors |
| 3 | Auth core | packages/auth/src/server/auth.ts:betterAuth | req -> secondaryStorage+customRules | customRules paths relative without api-auth prefix |
| 4 | Session persist | packages/auth/src/server/auth.ts:secondaryStorage | session -> Redis bare token + PG row | Redis blip falls back to PG; increment fail-open allow |
| 5 | Cookie fan-out | packages/auth/src/server/auth.ts:nextCookies | session -> Set-Cookie | Must stay last plugin or Next Server Actions lose cookie |
| 6 | Lifecycle hooks | packages/auth/src/server/database-hooks.ts:databaseHooks | user/session event -> audit + stash | Role/ban owned by auditLogPlugin not hooks to avoid double-audit |
| 7 | Admin audit | packages/auth/src/server/audit-plugin.ts:auditLogPlugin | before guard+stash -> after isSuccess write | Failure never writes; never invalidates on failure |
| 8 | Gateway read | apps/web/src/lib/server/auth-http.ts:getSessionFromApi | cookie -> callAuthApi GET /get-session | 5s timeout maps to 503/504 via fetch-internal |
## Files
- Fact: `packages/auth/src/server/auth.ts` owns `secondaryStorage`, `customRules`, `nextCookies`, `databaseHooks` mount.
- Fact: `packages/auth/src/server/pending-storage.ts` owns bare-token key plus `invalidateUserCache` plus pending stash.
- Fact: `packages/auth/src/server/audit-plugin.ts` plus `database-hooks.ts` own sync auth audit plane.
- Fact: `apps/web/src/lib/auth/auth-client.ts` owns `createAuthClient` plus `classifyEndpoint` plus 429 `onError`.
- Fact: `apps/web/src/lib/server/auth-http.ts` owns `callAuthApi` plus `getSessionFromApi` gateway.
## Failure branches
- Fact: Redis down -> `secondaryStorage.get` returns null to PG; `increment` returns 0 allow; throttler memory fallback.
- Fact: Wrong password -> 401; banned -> 403; 2FA wrong -> 401 with attempts bound 5.
- Fact: Gateway 5s timeout -> `GATEWAY_TIMEOUT` 504; unreachable API -> `SERVICE_UNAVAILABLE` 503.
- Fact: Impersonation while impersonated -> 403 blocked by `auditLogPlugin` before hook plus `hierarchy.ts`.
## Security + observability implications
- Fact: Password policy enforced server-side on sign-up/change; OAuth links via `accountLinking`.
- Fact: `X-Forwarded-For` plus `traceparent` forwarded by nginx; IP resolved via trusted CIDR list.
- Fact: Auth events counted in `main.ts` auth-event middleware via `recordAuthEvent` plus `recordRateLimitHit`.
- Interpretation: Changing cookie or CORS or trustedOrigins without gateway test breaks SSR silently.
## Linked invariants
- Recommendation: Enforced by [INV-001 Architecture B](../invariants/01-architecture-b.md) plus [INV-002 Fresh Role](../invariants/02-fresh-role.md).
- Recommendation: Context rules in [INV-003 Request Context](../invariants/03-request-context.md) plus limits in [INV-006 Rate Limits](../invariants/06-rate-limits.md).
- Uncertainty: FINAL-10 Q5 dummy OAuth controller runs only when `OAUTH_TEST_PROVIDER=1`; prod must never set it. See `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q5.
## Up link
- Fact: Up: `../00-INDEX.md`; task routes T2 change-auth plus T10 security; subsystems `auth-better-auth` plus `security`.
