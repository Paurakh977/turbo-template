---
title: "Subsystem: Web Runtime (Next Gateway, Proxy, Bootstrap)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/web-runtime.md"]
sources: ["apps/web/src/proxy.ts", "apps/web/src/instrumentation.ts", "apps/web/src/instrumentation-client.ts", "apps/web/src/lib/server/fetch-internal.ts", "apps/web/src/lib/server/internal-api.ts", "apps/web/src/lib/server/bootstrap.ts", "apps/web/src/lib/server/request-fingerprint.ts", "apps/web/src/lib/server/api-errors.ts", "apps/web/next.config.js", "apps/web/Dockerfile.prod", "apps/web/Dockerfile.dev"]
depends_on: ["invariants/01-architecture-b.md", "invariants/10-ui-enforcement.md"]
guards: ["apps/web/src/proxy.spec.ts", "scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Web Runtime (Next Gateway, Proxy, Bootstrap)
> Up: ../00-INDEX.md | Depends on: INV-01 (secret-free web), INV-10 (presentational versus enforced). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Owned by `apps/web/src/proxy.ts` (90 lines, CSP plus nonce) plus `apps/web/src/instrumentation.ts` (122 lines, Node OTel) plus `apps/web/src/instrumentation-client.ts` (89 lines, Faro RUM).
**Fact:** Gateway owned by `apps/web/src/lib/server/fetch-internal.ts` (131 lines, single fetch core) plus `internal-api.ts` (164 lines, domain gateway) plus `bootstrap.ts` (63 lines, React cache) plus `request-fingerprint.ts` (42 lines, tuple).
**Fact:** Shell owned by `apps/web/src/app/layout.tsx` plus `next.config.js` (130 lines, env validation) plus `Dockerfile.dev` plus `Dockerfile.prod` (standalone runner).
**Recommendation:** Change gateway, proxy, or bootstrap only here; auth screens live in web-auth-admin.md, never here.
## 2. Runtime
**Fact:** Browser path is proxy (nonce plus CSP, no auth) -> layout (cookie theme plus x-nonce) -> `getRequestBootstrap` (forwarded cookie, IP, UA, Origin) -> `callInternalApi` (`INTERNAL_API_URL`, 5s timeout) -> Nest.
**Fact:** `proxy()` in `proxy.ts:63-84` mints `nonce=btoa(crypto.randomUUID())`, sets `x-nonce` plus `Content-Security-Policy` on request for render and enforced CSP on response.
**Fact:** `buildCSP()` in `proxy.ts:45-61` sets `script-src self nonce strict-dynamic` (plus `unsafe-eval` only in development), `style-src self unsafe-inline`, `connect-src` from `connectSrc`, `img-src self data blob https`, `object-src none`, `frame-ancestors none`.
**Fact:** `register()` in `instrumentation.ts:25-27` runs only when `NEXT_RUNTIME==nodejs`; edge does nothing; `OTEL_SDK_DISABLED==true` fail-opens with log and return.
## 3. Public API
**Fact:** Web exposes no DB or auth runtime; all server data flows through two thin gateways with identical 5s budget.
| Symbol | Contract | Source |
|---|---|---|
| internalApiBaseUrl | trims INTERNAL_API_URL, throws Docker hint when missing | fetch-internal.ts:56-67 |
| buildForwardedHeaders | accept json plus verbatim cookie, XFF, x-real-ip, UA, origin | fetch-internal.ts:74-90 |
| callInternalApi | GET POST PATCH DELETE, no-store, omit, 204 void, non-ok throw | internal-api.ts:79-164 |
| getRequestBootstrap | fingerprint primitives into cached bootstrap, with split | bootstrap.ts:50-62 |
**Fact:** `DEFAULT_TIMEOUT_MS=5000` in `fetch-internal.ts:17`; timeout maps to 504, unreachable maps to 503 via `throwTimeoutAsApiError` plus `throwUnreachableAsApiError`.
## 4. Dependency direction
**Fact:** Allowed: pages plus layouts plus actions into `bootstrap.ts` plus `internal-api.ts` plus `auth-http.ts`; gateways into `fetch-internal.ts` plus `request-fingerprint.ts`; layout into `faro-init.tsx`.
**Fact:** Forbidden: web MUST NOT import `@repo/auth` root runtime or `pg` or `ioredis`; only `import type` plus pure subpaths `roles`, `permissions`, `password-policy`.
| Check | Grep |
|---|---|
| No runtime auth | rg -n "from '@repo/auth'" apps/web/src, expect only type or subpath |
| No DB stack | rg -n "DATABASE_URL\|BETTER_AUTH_SECRET" apps/web/src, expect only comments |
| Single CSP owner | rg -ni Content-Security-Policy nginx/nginx.conf apps/api/src/main.ts, expect empty |
**Recommendation:** New gateway MUST reuse `fetch-internal.ts` helpers, never fork fetch logic.
## 5. Security posture
**Fact:** `connectSrc` in `proxy.ts:10-32` is `self` plus `NEXT_PUBLIC_API_URL` origin plus `NEXT_PUBLIC_FARO_COLLECTOR_URL` origin only when absolute, try-caught, deduped.
**Fact:** `config.matcher` in `proxy.ts:86-90` excludes `_next/static`, `_next/image`, `favicon.ico`, images; all else runs proxy for nonce plus CSP.
**Fact:** `fetch-internal.ts:92-119` keeps `cache:no-store` plus `credentials:omit`; cookies travel as explicit header, never fetch credentials, so Next never caches per-user auth.
**Fact:** `next.config.js:59-63` validates Faro identity only when collector set; server OTel is NOT validated there (builder lacks OTel; `instrumentation.ts` owns boot fail-fast).
## 6. Failure modes
**Fact:** Missing `INTERNAL_API_URL` throws `APIError` with Docker versus host hint; missing `NEXT_PUBLIC_API_URL` throws at `next.config.js:20-50` build validation.
**Fact:** Auth gateway 5s timeout surfaces as 504, DNS or refused as 503; pages map 401 to redirect, 404 to `notFound()`, else to `error.tsx` via `throwUnlessAuth` plus `resolvePageData`.
**Fact:** Faro missing collector returns silent in dev, warns in prod (`instrumentation-client.ts:27-38`); init failure warns except test; app never crashes on RUM loss.
**Fact:** `server-audit.ts` fire-and-forget POST to `/api/audit-logs` swallows to `console.error` only; settings demo rows may loss versus notes transactional audit.
## 7. Performance
**Fact:** `fetchBootstrapCached=cache()` in `bootstrap.ts:29-48` is request-scoped, keyed by four primitives (cookie, forwardedFor, realIp, userAgent) plus `with` flag; never pass `Headers` object (new wrapper defeats memo).
**Fact:** Documented counts: notes layout 1 plus page 0 plus notes 1 equals 2 HTTP; settings base 1 plus accounts 1 equals 2; admin layout 1 plus page 1 equals 2; audit 1 to 2.
**Fact:** All authenticated segments set `export const dynamic=force-dynamic` (dashboard layout, notes page, settings page, admin page, audit page); without it Next could cache RSC across users.
**Fact:** `checkServerActionRateLimit` parallelizes bootstrap plus rate-check; reads use `failOpen true`, mutations use `failOpen false`.
## 8. Config/Env
**Fact:** `next.config.js:1-18` loads `../../.env` plus `../../.env.k6` overlay when `K6_TESTING==true`; drops root `PORT 3001` when unset so web keeps 3000.
**Fact:** Required at build: `NEXT_PUBLIC_API_URL` (absolute or slash-prefixed); Faro trio `NEXT_PUBLIC_FARO_*` when collector set; `NEXT_ALLOWED_DEV_ORIGINS` validated in dev.
**Fact:** `Dockerfile.prod:builder` bakes `NEXT_PUBLIC_*` plus Faro as `ARG`; secrets never enter `ARG`; runtime `ENV` carries only public plus `OTEL_SDK_DISABLED` plus Faro (no `DATABASE_URL`, no `BETTER_AUTH_SECRET`).
**Recommendation:** Changing any `NEXT_PUBLIC_*` REQUIRES web rebuild; secret or pool change needs container recreate only.
## 9. Testing/verification
**Fact:** `proxy.spec.ts` (101 lines) asserts CSP directives, nonce regex, no `unsafe-eval` in prod, `connect-src self`, matcher exclusions; run `pnpm --filter web test`.
**Fact:** `bootstrap.spec.ts` plus `internal-api.spec.ts` plus `auth-http.spec.ts` plus `api-errors.spec.ts` cover cache keys, 204 void, 404-to-null, 401 redirect versus error card; run web unit suite.
**Fact:** Playwright `e2e/tests/proxy/proxy.spec.ts` plus `health` plus `errors` prove edge CSP plus nonce plus error cards through `proxy-e2e` TLS; run `pnpm --filter web test:e2e -g proxy`.
**Recommendation:** After proxy, gateway, or bootstrap change run web unit plus e2e proxy plus `guard:web-secrets --strict` plus `guard:web-auth-imports`.
## 10. Extension pointer
**Recommendation:** Add gateway by adding thin wrapper over `callAuthApi` or `callInternalApi` with `buildForwardedHeaders`, never raw `fetch` with manual headers.
**Recommendation:** Add authenticated page by setting `force-dynamic`, calling 
**Recommendation:** Add forwarded header by editing buildForwardedHeaders plus request-fingerprint atomically plus spec for tuple order.
## 11. AI-guidance
MUST: keep proxy pure CSP no auth redirect cookie read; keep cache no-store plus credentials omit; keep force-dynamic on authed segments; keep fingerprint primitives only.
MUST: keep strict-dynamic with nonce; keep connect-src self plus API plus Faro; keep 5s timeout mapping 504 versus 503; keep captureConsole false in Faro.
MUST-NOT: hardcode api auth path use AUTH_BASE_PATH; concat callback URLs use buildAbsoluteUrl; pass Headers to cache; add CSP in nginx or API; import auth runtime or pg in web.
## 12. Common mistakes
**Interpretation:** Adding auth redirect to proxy for convenience couples edge to session shape and bypasses layout bootstrap fingerprint; keep auth in layouts plus require-admin.
**Interpretation:** Passing headers object into cache defeats memo because Next returns new wrapper per call; derive fingerprintCacheArgs first.
**Interpretation:** Forgetting force-dynamic on new dashboard page lets Next cache one user RSC for next user; every authed segment must set it.
**Interpretation:** Concatting NEXT_PUBLIC_APP_URL plus path breaks trailing slash plus proxy base; use buildAbsoluteUrl with getAppBaseUrl.
## 13. Related
Invariants: INV-01 secret-free web, INV-10 presentational versus enforced pointers only rules not repeated. Flows: flows/authenticated-api.md, flows/e2e.md future. Subsystems: web-auth-admin.md, security.md, observability-app.md, nginx-edge.md. Workflows: add-domain-module.md, change-docker-env.md future. ADRs: ADR-0003 Arch-B, ADR-0010 baked RUM future.
## 14. Refs
apps/web/src/proxy.ts, apps/web/src/proxy.spec.ts, apps/web/src/instrumentation.ts, apps/web/src/instrumentation-client.ts, apps/web/src/lib/ui/faro-init.tsx, apps/web/src/lib/server/fetch-internal.ts, apps/web/src/lib/server/auth-http.ts, apps/web/src/lib/server/internal-api.ts, apps/web/src/lib/server/bootstrap.ts, apps/web/src/lib/server/request-fingerprint.ts, apps/web/src/lib/server/api-errors.ts, apps/web/src/lib/server/server-action-rate-limit.ts, apps/web/src/lib/server/server-audit.ts, apps/web/next.config.js, apps/web/Dockerfile.dev, apps/web/Dockerfile.prod, apps/web/playwright.config.ts.
> **Uncertainty:** Web pg and ioredis devDeps may be leftover breaking Arch-B hygiene and image weight. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q12; grep src usage plus serverExternalPackages then remove or document before claiming secret-free.
> **Uncertainty:** E2E app.e2e-spec slash versus api prefix drift is unverified; stub expects Hello World without prefix while global prefix is api. See FINAL-10-OPEN-QUESTIONS.md Q1; run stub suite and fix or delete before trusting proxy e2e green.
| Gateway | Method | Timeout | On fail |
|---|---|---|---|
| callAuthApi | GET POST via AUTH_BASE_PATH | 5000ms 504 | 503 unreachable, APIError non-ok |
| callInternalApi | GET POST PATCH DELETE via INTERNAL_API_URL | 5000ms 504 | 204 void, 404 null only in auth wrappers |
| getRequestBootstrap | cached GET users me bootstrap | 5000ms shared | 401 redirect, else error card |
| checkServerActionRateLimit | POST rate-limit check | 5000ms shared | failOpen true reads, false mutations |
**Fact:** Single choke point is fetch-internal.ts; divergence contained only if gateways stay thin and share timeout plus forwarding plus status mapping.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR per FINAL-09.
| Segment | force-dynamic | Bootstrap cost |
|---|---|---|
| dashboard layout | yes | 1 cached |
| dashboard notes page | yes | 0 reuse plus 1 list |
| dashboard settings page | yes | 1 with accounts |
| admin layout plus page | yes | 1 collapsed via cache |
| admin audit page | yes | 1 to 2 with requireAdmin |
**Fact:** Code wins over wiki; proxy plus fetch-internal plus bootstrap win over prose per authority model.
**Recommendation:** Touching gateway, proxy, or bootstrap MUST update web-auth-admin plus ports-topology plus test-matrix same PR when behavior changes.
### Verification commands
**Fact:** Run pnpm filter web test for proxy plus gateway unit, test e2e proxy for edge CSP, guard web-secrets strict for leak, guard web-auth-imports for runtime import.
**Recommendation:** Diff Dockerfile.prod ARGs against next.config required keys in every web env PR; drifted ARG silently bakes stale URL.
**Fact:** CSP nonce flows proxy to requestHeaders x-nonce to layout script nonce; both required or framework scripts plus theme init break.
**Recommendation:** Never add auth redirect to proxy; keep pure CSP presentational shell plus gateway enforcement split per INV-10.
### Gateway error reference
| Status | Meaning | Page action |
|---|---|---|
| 401 | session missing or expired | redirect auth |
| 403 | fresh role denies | error card |
| 404 | bootstrap missing | notFound |
| 429 | rate limited | Slow down card |
| 503 504 | gateway timeout | Service unavailable card |
**Fact:** Pages redirect only auth else error card; actions return error object except 401 null bootstrap redirect.
**Recommendation:** New pages MUST use throwUnlessAuth or resolvePageData; actions MUST use toActionError with classify guard.
