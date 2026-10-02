---
title: "Subsystem: Security (Boundaries, Cookies, Input, IP, Invalidation)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/security.md"]
sources: ["apps/api/src/main.ts", "packages/auth/src/server/auth.ts", "packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/hierarchy.ts", "apps/api/src/common/audit-metadata.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/audit/audit.controller.ts", "packages/auth/src/shared/client-ip.ts", "apps/api/src/common/client-meta.ts", "apps/web/src/proxy.ts", "apps/web/src/lib/server/fetch-internal.ts"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "invariants/10-ui-enforcement.md"]
guards: ["apps/api/test/integration/modules/security-regression.integration.spec.ts", "apps/api/test/integration/modules/auth-security.integration.spec.ts", "packages/auth/src/shared/client-ip.spec.ts", "apps/api/src/common/audit-metadata.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Security (Boundaries, Cookies, Input, IP, Invalidation)
> Up: ../00-INDEX.md | Depends on: INV-01 (secret-free web), INV-02 (fresh role), INV-10 (presentational versus enforced). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Edge owned by apps/api/src/main.ts (helmet, CORS single owner, trust proxy, pipes, filters) plus nginx.conf zones and headers; session owned by packages/auth/src/server/auth.ts (cookies, origins, 2FA, JWT secondary); verdicts owned by hierarchy.ts plus audit-plugin.ts plus authorization.service.ts; attribution owned by audit-metadata.ts plus audit-writer.ts plus audit.controller.ts.
**Fact:** Identity transport owned by client-ip.ts (auth tier CIDR walk) plus client-meta.ts (API tier trust proxy 1) plus fetch-internal.ts (web gateway forwarding); presentation owned by proxy.ts (single CSP owner with nonce) plus require-admin.ts (presentational redirects).
**Fact:** This file is the pre-change checklist: read the pinned file plus its header comment before touching auth, authz, audit, rate-limit, IP, or CORS; mechanism detail lives in auth-better-auth.md, rbac-rules-users.md, audit.md.
## 2. Runtime
**Fact:** Default-deny: global vendor AuthGuard authenticates every route; only health (live plus ready) and links read-only (GET plus GET id) carry AllowAnonymous, because HEALTHCHECK plus depends_on service_healthy deadlock otherwise.
**Fact:** Fresh-DB-role: getFreshRoleRaw memoized per request per user in ALS roleCache via db.user.findUnique role; evaluateAppPermissions via shared ADMIN_PLUGIN_ROLES through parseRoles; session cookie role is UI hint only with up to 7d staleness (SESSION_EXPIRES_IN).
**Fact:** Hierarchy strict greater-than plus assign-guard at-or-above plus self-ban and self-delete blocks with blocked-attempt audit rows plus nested-impersonation block; enforcement attributes to acting admin via effectiveUserId.
**Fact:** Three-layer rate limits: nginx zones (auth 300r/m, api 10r/s, general 30r/s defaults, health never throttled shape) into BetterAuth customRules (get-session 300/min, sign-in 5, sign-up 3, 2FA 3 per 10s, destructive 2) into Nest global throttler 60s 200 fail-open plus server-action Lua limiter with 9-scope allowlist.
## 3. Public API
| Boundary | Contract | Source |
|---|---|---|
| Anonymous | health live plus ready, links read-only; every new public endpoint copies links pattern | health.controller.ts, links.controller.ts |
| Session cookie | useSecureCookies true, nextCookies last, 7d expiry 1d updateAge 15min freshAge | auth.ts |
| Audit write | 3-action allowlist, 4K cap, server-stamped impersonation | audit.controller.ts, audit-metadata.ts |
| Rate check | POST api/rate-limit/check with IsIn scope, window 1s-1h, max 1-1000, session-derived id | server-action-rate-limit.controller.ts |
**Fact:** IP: auth resolveClientIp walks XFF right-to-left past TRUSTED_PROXY_CIDRS failing closed on malformed hops; API extractClientMeta uses req.ip one-hop trust then x-real-ip else null; both reject leftmost-XFF reads.
## 4. Dependency direction
**Fact:** Allowed: web into API over HTTP gateways with verbatim cookie plus XFF plus x-real-ip plus UA forwarding, 5s timeout, 503 plus 504 mapping; web into type-only Auth plus pure subpaths (roles, permissions, password-policy) plus SERVER_ACTION_SCOPES; services into AuthorizationService plus extractClientMeta.
**Fact:** Forbidden: web MUST NOT hold DATABASE_URL, BETTER_AUTH_SECRET, DIRECT_URL and MUST NOT call auth.api or db directly; API MUST NOT re-enable library CORS; nobody adds CSP in nginx or API; nobody reads XFF index 0; nobody trusts client metadata server keys.
| Check | Grep |
|---|---|
| Secret-free web | rg -n DATABASE_URL\|BETTER_AUTH_SECRET apps/web/src, expect only comments and e2e helpers |
| No runtime auth import | rg -n from '@repo/auth' apps/web/src, expect only import type or subpaths |
| No leftmost XFF | rg -n split.*,.*\[0\] packages/auth/src/shared/client-ip.ts apps/api/src/common/client-meta.ts, expect empty |
| Single CSP owner | rg -ni Content-Security-Policy nginx/nginx.conf apps/api/src/main.ts, expect empty |
## 5. Security posture (detail)
**Fact:** Cookies: advanced.useSecureCookies true all envs behind TLS-terminating nginx; nextCookies last in plugins for Server-Action Set-Cookie; session storeSessionInDatabase true so delete hooks fire; expiry 7d, updateAge 1d, freshAge 15min for delete-user.
**Fact:** Origins: trustedOrigins prod excludes localhost, includes appURL plus TRUSTED_ORIGINS split; main.ts CORS mirrors with localhost only when NODE_ENV not production, credentials true, PATCH included, untrusted origin gets no ACA headers (browser blocks, never throw to 500); disableTrustedOriginsCors true keeps one owner.
**Fact:** Input: global ValidationPipe transform plus whitelist plus forbidNonWhitelisted; note DTO MaxLength 200 title 5000 content, limit Max 500 offset Max 10000, explicit boolean coercion; rate DTO IsIn SCOPES window 1s-1h max 1-1000; audit DTO IsIn 3 actions plus 4K cap plus list query truncation q 100 action 64.
**Fact:** Headers: API helmet CSP false CORP cross-origin frameguard deny HSTS prod-only referrer strict-origin; nginx adds frame options plus nosniff plus referrer plus HSTS but never CSP; single CSP owner proxy.ts buildCSP with nonce plus strict-dynamic; traceparent plus tracestate plus baggage allowlisted in CORS plus nginx proxy_set_header plus web forwarding.
## 6. Failure modes
**Fact:** Redis blip: Nest throttler fail-open to bounded memory window 5000 keys (never blocked state), BetterAuth increment to allow, secondaryStorage to PG; availability over strictness during blip, permissive per-instance under long outage so alert on warn log.
**Fact:** Auth failure closed where it matters: unknown origin gets no CORS headers; unknown scope 400; unknown audit action 400; non-admin admin-list deny-by-default; invalid XFF hop yields undefined not spoofed IP.
**Fact:** Audit loss accepted narrowly: auth sync swallow plus web forwarder console-only are best-effort by design; domain same-tx outbox preserves atomicity by rethrowing enqueue failure so the note rolls back too.
**Fact:** Topology change breaks IP agreement: auth CIDR walk plus API one-hop trust agree only for single-nginx and nginx-to-web-to-api where only the edge appends; second appending proxy outside RFC1918 needs both files revisited.
## 7. Performance
**Fact:** Rate budgets bound floods without blocking legit polling: nginx per-IP connection level, BetterAuth per-endpoint anti-brute-force, Nest global replica-shared budget, server-action per-user mutations; k6 treats 429 expected and 5xx failure.
**Fact:** Session fast path: Redis L1 plus 1d updateAge plus skipped JWT header work; verdicts one PG role read per request memoized; audit background saves 1 RTT on domain writes.
**Fact:** Read paths bounded: audit list atomic count plus page with 300 user-hydrate cap and ID split; notes list withTotal false skips COUNT; purge hourly 1000 PK-delete avoids long locks.
## 8. Config/Env
**Fact:** Single sources: API Joi in app.module.ts plus auth env.ts plus database client parsers plus turbo passThroughEnv plus load-env.ts; fail-fast on missing secret, missing RESEND key without relaxed flag, placeholder secret in prod runtime.
**Fact:** Numeric parsers required everywhere (parseThrottleInt, parseIntEnv, parsePositiveInt) because compose empty-string plus Number empty equals 0 silently zeroes budgets.
**Fact:** Migrate uses DIRECT_URL 5432 direct, runtime uses DATABASE_URL 6432 pooler with pgbouncer true; batch audit transaction relies on it; builder uses placeholder URLs never connecting.
## 9. Testing/verification
**Fact:** Proofs: hierarchy.spec.ts strict greater-than, client-ip.spec.ts CIDR walk, client-meta.spec.ts trust-1, permissions plus notes-rbac integration fresh-role, audit plus audit-logging integration dual planes DLQ, rate-limit-thresholds plus e2e ratelimit 3 layers, security plus auth-security CORS helmet throttle, admin plus permissions self-ban impersonation, stop-impersonation exactly-one row, pending-storage GETDEL atomicity.
**Fact:** Health throttle contract: security-regression 210 sequential hits must 429; in-container probes on loopback versus external floods via gateway XFF never share a bucket, so throttling health is safe.
**Recommendation:** Run the affected spec plus integration plus e2e slice before merging auth, authz, audit, rate, IP PRs; keep security-regression 210-hit green; e2e needs the full e2e profile nginx TLS plus seed, host-only skips the edge.
## 10. Extension pointer
**Fact:** Seams follow the notes canonical example: module notes.module pattern, model Prisma DIRECT_URL migrate, controller no local guard with Session plus extractClientMeta, service fresh-role assert plus queue tx, permission extend statement plus ADMIN_PLUGIN_ROLES plus evaluate, role add weight plus parse plus hierarchy cover, route decide anonymous versus guarded plus throttle.
**Recommendation:** Scaffold by duplicating the notes plus audit plus users trio then renaming; dashboard reads via getRequestBootstrap never direct DB; audit chooses plane plus sanitize plus cap; metrics via metrics.service with bounded labels; add IsIn plus MaxLength plus cap plus assign-guard plus hierarchy plus invalidation day one.
## 11. AI-guidance
MUST: inject AuthorizationService and call getFreshRoleRaw(getEffectiveUserId(session)) then assertPermission for new endpoints; use resolveClientIp (fetch headers) or extractClientMeta (Express req) for new audit writers; set impersonation markers AFTER sanitization; keep server-action identifier session-derived.
MUST-NOT: add AllowAnonymous to a mutation or user-scoped read; trust session.user.role for verdicts; split XFF index 0; re-enable library CORS; add CSP outside proxy.ts; add SkipThrottle on health; add bypass header or zone removal for k6; mint unbounded server-action keys with regex checks; trust client impersonatedBy; widen CLIENT_AUDIT_ACTIONS to security events.
## 12. Common mistakes
**Interpretation:** Per-controller AuthGuard duplicates getSession; the global guard already resolves once per request.
**Interpretation:** Plugin after nextCookies drops Set-Cookie in server actions with no error; localhost in prod trustedOrigins lets any local listener read credentialed responses.
**Interpretation:** Second CORS via AuthModule breaks PATCH and 500s simple requests; CSP in nginx or API breaks Faro beacons with no log since intersection is most-restrictive-wins.
**Interpretation:** session-colon deletes or JWKS cache breaks grace rotation; role write without assign-guard allows peer escalation; impersonated admin routes break isolation; Number env fallback zeroes budgets via empty string; migrate via pooler fails locks; cross-request role cache causes stale enforcement; ALS read in workers is undefined by design; audit metadata with secrets leaks to audit_log.
## 13. Related
Invariants: INV-01, INV-02, INV-10 (pointers only). Subsystems: auth-better-auth.md (session mechanics), rbac-rules-users.md (weights), audit.md (outbox internals), plus future redis key inventory, nginx zones, web-runtime plus web-auth-admin gateways, database DIRECT_URL pools, observability trace audit, testing matrix, cross-system flows. Flows: auth.md, authenticated-api.md, audit.md, rate-limited.md (future).
## 14. Refs
apps/api/src/main.ts, app.module.ts, auth.ts, audit-plugin.ts, hierarchy.ts, database-hooks.ts, client-ip.ts, client-meta.ts, authorization.service.ts, request-context.ts, request-context.interceptor.ts, audit-writer.ts, audit-metadata.ts, audit/audit.controller.ts, notes/notes.controller.ts, notes/dto/note.dto.ts, rate-limit/redis-throttler.storage.ts plus server-action-rate-limit service plus controller, auth-http.ts plus internal-api.ts plus fetch-internal.ts plus require-admin.ts plus server-audit.ts, proxy.ts, nginx.conf, database/src/client.ts, roles/src/index.ts.
> **Uncertainty:** Dummy-OAuth test provider plus OAUTH_TEST_PROVIDER unset in real envs is untraced; test-only provider must never run in prod. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q5; grep compose plus hosting env plus controller trace before touching OAuth wiring.
> **Uncertainty:** Overlong user-agent is TEXT uncapped with only metadata 4K-capped; hostile UA can bloat rows. See FINAL-10-OPEN-QUESTIONS.md Q7; truncate at 1K plus test.
> **Uncertainty:** Web pg and ioredis devDeps may be leftover, breaking Arch-B hygiene and image weight. See FINAL-10-OPEN-QUESTIONS.md Q12; grep src usage plus serverExternalPackages, then remove or document.
> **Uncertainty:** Resend, dummy-OAuth, and host-rewrite edge cases assume CIDR-versus-hop agreement that breaks if a load balancer is added. See FINAL-10-OPEN-QUESTIONS.md Q13; open an ADR when topology changes, do not patch ad hoc.
### Dangerous-change checklist reference
| Number | Change | Breaks |
|---|---|---|
| 1 | SkipThrottle on health | 210-hit 429 contract |
| 2 | XFF index 0 read | IP attribution, forged audit IP |
| 3 | session.user.role verdict | freshness, stale elevation to 7d |
| 4 | Per-controller AuthGuard | double getSession, split-brain attribution |
| 5 | Plugin after nextCookies | Server-Action Set-Cookie silently dropped |
| 6 | Localhost in prod origins | local-listener credential theft |
| 7 | Second CORS via AuthModule | PATCH loss, divergent 500s |
| 8 | CSP in nginx or API | Faro beacons broken, no log |
| 9 | session-colon deletes, JWKS cache | grace rotation, revived sessions |
| 10 | Role write without assign-guard | peer escalation |
| 11 | Impersonated admin routes | support-view isolation |
| 12 | Regex scope check | unbounded server-action keys |
| 13 | Client rate identifier | burns another user budget, use session id |
| 14 | Number env fallback | empty string zeroes budgets |
| 15 | Migrate via pooler URL | lock failures, use DIRECT_URL |
| 16 | Cross-request role cache | stale enforcement globally |
| 17 | ALS read in workers | undefined by design, capture at emit |
| 18 | Audit metadata secrets | leaks into audit_log, redact tokens |
### Invalidation reference
| Mutation | Hook | Cache clear |
|---|---|---|
| set-role, ban, unban | admin after isSuccess | bare token plus active-sessions userId |
| revoke sessions, single | admin after isSuccess | plus stashed single token |
| remove-user, password admin | admin after isSuccess | full user tokens |
| self delete | user.delete.after with stash | stashed token plus id |
| impersonate, stop | create.after, delete.before plus after | stop path excepted by design |
**Fact:** Findings above map to cited header comments; each passes lint yet breaks a boundary, so require second review when touched.
**Recommendation:** Copy this table into the PR checklist for any auth, authz, audit, rate, IP, CORS, cookie, or invalidation change.
### Verification commands
**Fact:** Run security-regression plus auth-security plus attack-surface integration, client-ip plus client-meta plus audit-metadata unit specs, hierarchy plus permissions package specs, and e2e security plus proxy plus ratelimit slices for edge behavior.
**Fact:** k6 spike asserts 429s fire with 5xx near zero; stress plus load assert p95 bounds with 5xx gates; capacity measures the ceiling with dropped zero and no latency gate.
**Recommendation:** Add lint where a dangerous change is mechanically detectable (AllowAnonymous on mutations, XFF index read, session-colon deletes, second CORS registration, CSP outside proxy, bypass headers, SkipThrottle on health).
**Recommendation:** Edit the boundary plus the coupled mechanism doc in the same PR; policy here, mechanism in the companion subsystem.
### Maintenance notes
**Fact:** Header layering is safe everywhere except CSP: API helmet plus nginx static headers plus proxy dynamic CSP coexist because only proxy owns CSP.
**Recommendation:** When adding a forwarded header, add it in main.ts CORS plus nginx proxy_set_header plus fetch-internal.ts when web-initiated, and cover it with an e2e proxy assertion.
