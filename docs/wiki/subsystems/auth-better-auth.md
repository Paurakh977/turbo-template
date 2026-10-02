---
title: "Subsystem: Auth (Better Auth Session, Persistence, Lifecycle)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/auth-better-auth.md"]
sources: ["packages/auth/src/server/auth.ts", "packages/auth/src/server/infra/redis.ts", "packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "packages/auth/src/server/hierarchy.ts"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "invariants/06-rate-limits.md"]
guards: ["apps/api/test/integration/modules/auth-flow.integration.spec.ts", "apps/api/test/integration/modules/auth-session.integration.spec.ts", "packages/auth/src/server/hierarchy.spec.ts", "packages/auth/src/server/pending-storage.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Auth (Better Auth Session, Persistence, Lifecycle)
> Up: ../00-INDEX.md | Depends on: INV-01 (secret-free web), INV-02 (fresh role), INV-06 (rate limits). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Single authoritative instance is betterAuth export auth from packages/auth/src/server/auth.ts (663 lines); no other file constructs a Better Auth runtime.
**Fact:** Mechanism owners: infra/redis.ts (shared client singleton), pending-storage.ts (335 lines, hook stashes plus invalidation), audit-plugin.ts (739 lines, admin before-guards plus after-audit), database-hooks.ts (305 lines, lifecycle audit plus canonicalization), hierarchy.ts (66 lines, comparison primitive).
**Fact:** Policy companions live elsewhere: role tokens in packages/roles/src/index.ts, AC registry in shared/permissions.ts, verdicts in subsystems/rbac-rules-users.md; this file owns session mechanics, not verdict semantics.
## 2. Runtime
**Fact:** Session lookup is Redis L1 then Postgres: secondaryStorage in auth.ts:174-287 does GET bare-token (no session prefix in 1.6.29), falling back to the Session table via prismaAdapter with storeSessionInDatabase true; updateAge 1d throttles rewrites, expiry 7d, freshAge 15min gates destructive delete-user.
**Fact:** API plumbing: AuthModule.forRoot with auth plus disableTrustedOriginsCors plus bodyParser 2mb (app.module.ts:173-184) registers the global vendor AuthGuard; main.ts sets trust proxy 1 with a single CORS layer; api/auth paths bypass Nest interceptors as raw Express mounts.
**Fact:** Per-request flow: vendor guard resolves req.session (401 unless AllowAnonymous), RequestContextInterceptor copies it into ALS read-only, controllers consume Session exactly once and never re-resolve (authorization.service.ts header contract).
**Fact:** Cookies use advanced.useSecureCookies true with nextCookies last in plugins; trustedOrigins excludes localhost in prod; backgroundTasks.handler is fire-and-forget, never awaited in the response path.
## 3. Public API
**Fact:** Better Auth owns api/auth paths (sign-up, sign-in, sign-out, session, 2FA, verification, password reset, admin paths); Nest owns domain routes plus api/users/me fresh-identity reads (see rbac-rules-users.md).
| Surface | Contract | Source |
|---|---|---|
| GET api/auth/get-session | Hottest path, custom rule 300 per min, Redis L1 with PG fallback | auth.ts customRules |
| POST api/auth/sign-up/email | Password-policy hook plus verification send | auth.ts hooks.before |
| api/auth/admin paths | Vendor gate adminRoles admin plus superAdmin, plus hierarchy and assign-guards | audit-plugin.ts, hierarchy.ts |
| GET api/auth/token and jwks | JWT secondary path, 30-min payload, ES256, PG Jwks rotation | auth.ts jwt block |
**Fact:** JWT header emission is disabled (disableSettingJwtHeader true); zero prod consumers read set-auth-jwt, saving about 180-200 ms per get-session.
## 4. Dependency direction
**Fact:** Allowed: auth.ts into infra redis, pending-storage, audit-plugin plus database-hooks, permissions plus roles registry; app.module.ts into auth single forRoot; web into pure subpaths (roles, permissions, password-policy) plus HTTP gateways, never the runtime root.
**Fact:** Forbidden: web MUST NOT import the auth runtime or call auth.api directly; API services MUST NOT call getSession downstream; nobody invents prefixed session deletes (session colon id) because 1.6.29 writes bare tokens.
| Check | Grep |
|---|---|
| No web runtime import | rg -n from '@repo/auth' apps/web/src, expect only import type or roles, permissions, password-policy |
| No re-resolution | rg -n getSession apps/api/src/notes apps/api/src/users apps/api/src/audit, expect empty outside comments |
| No prefixed deletes | rg -n session: packages/auth/src/server/pending-storage.ts, expect no key writes |
## 5. Security posture
**Fact:** Passwords: native 8-128 plus hooks.before uppercase plus lowercase plus number plus symbol via validatePasswordPolicy on sign-up, change-password, reset-password token path; client mirror in apps/web/src/lib/shared/validation.ts.
**Fact:** Email: requireEmailVerification equals canSendEmail; prod fails fast without RESEND_API_KEY unless EMAIL_VERIFICATION relaxed; every sendEmail caller catch-logs so delivery failure never fails auth (email-helpers.ts no-ops without provider).
**Fact:** Social linking requires both client id and secret per provider; trustedProviders plus requireLocalEmailVerified blocks OAuth takeover of unverified local emails; OAuth auto-provision forces role user plus banned false.
**Fact:** 2FA: TOTP 6 digits per 30s, OTP email period 3 MINUTES with every other knob seconds, 5 attempts, 10x10 encrypted backup codes, 600s challenge cookie, 30d trusted device; self-delete requires password for credential accounts with freshAge 15min.
## 6. Failure modes
**Fact:** Redis down: secondaryStorage try/catch falls back to PG (secondary_storage_fallback_total), rate storage falls back to database, hook stashes fall back to in-process Maps; logins keep working slower; infra/redis.ts swallows error events so the process never crashes.
**Fact:** Email provider down: flows succeed, verification or reset mail lost-with-log; prod boot guard prevents silent unverified operation, it does not prevent runtime blips.
**Fact:** Admin mutation failure: isSuccess gate (audit-plugin.ts:39-50) skips audit write and invalidateUserCache, cleans pending stashes; failed attempts neither audit nor evict.
**Fact:** Self-deletion: before-hook stashes sessionToken plus sessionId plus ip plus ua plus email because post-delete findMany userId returns empty; user.delete.after invalidates with the stash, else the token lives until TTL.
## 7. Performance
**Fact:** L1 Redis absorbs hottest reads (get-session every SSR render plus focus refetch, 300/min rule); updateAge 1d bounds write amplification; JWT header work skipped entirely for prod traffic.
**Fact:** Hierarchy hooks do exactly 1 session plus 1 fresh target findUnique per admin call and return the row so callers never refetch (hierarchy.ts).
**Fact:** backgroundTasks.handler never blocks responses; auth audit writes are awaited-but-swallowed db.auditLog.create catch-log, one RTT on rare privilege paths only.
## 8. Config/Env
**Fact:** config/env.ts (getEnv, parseIntEnv) plus load-env.ts fail fast; placeholder secret throws in prod runtime except NEXT_PHASE phase-production-build; prod without RESEND_API_KEY throws unless EMAIL_VERIFICATION relaxed.
**Fact:** Session knobs: SESSION_EXPIRES_IN 7d, SESSION_UPDATE_AGE 1d, SESSION_FRESH_AGE 15min; rate knobs window 60s max 20 default, per-endpoint customRules (admin 2-6/min, challenge 2-5/min, destructive 2/min); paths post-basePath with no api/auth prefix.
**Fact:** Better Auth pinned 1.6.29 (CJS chain: auth tsconfig CommonJS plus Nest commonjs; 1.7 ESM-only jest cannot load); patch trims only package.json peers pg plus prisma-client for image hygiene, no runtime code.
## 9. Testing/verification
**Fact:** Package specs: hierarchy.spec.ts strict greater-than, pending-storage specs GETDEL atomicity plus TTLs, stop-impersonation-audit.spec.ts exactly-one row, client-ip.spec.ts CIDR walk, password-policy plus permissions plus email-helpers specs.
**Fact:** API integration: auth-flow (signup plus verification), auth-session (expiry plus revocation), auth-security (headers plus CORS), 2fa, jwt, oauth dummy only when OAUTH_TEST_PROVIDER 1, admin-mutations invalidation on success only.
**Recommendation:** Touching auth.ts, infra, pending-storage, audit-plugin, database-hooks, or hierarchy MUST run package tests plus full test:integration:all plus e2e auth slice; add a Redis-key-absence assertion after ban, revoke, self-delete (HTTP 401 alone can miss a surviving bare-token key).
## 10. Extension pointer
**Recommendation:** Change session TTLs, cookies, 2FA, email gating, or rate rules by editing auth.ts plus config/env.ts, mirroring new Joi keys across all three integration setups, updating reference/redis-keys.md plus rate-limit-matrix.md (future) the same PR.
**Recommendation:** Add a new admin mutation with a before guard (hierarchy plus self-block plus assign-guard plus stash) and an after hook (isSuccess plus write plus invalidate) in audit-plugin.ts, with an exactly-once spec; execution order in workflows/change-auth.md (future).
## 11. AI-guidance
MUST: keep bare-token key shape pinned to the installed better-auth version; keep invalidateUserCache after every role, ban, revoke, delete, password-admin mutation gated on success; keep stop-impersonation suppression stored BEFORE the endpoint and popped on failure; keep nextCookies last; keep useSecureCookies true.
MUST-NOT: unify me/role with me/permissions; cache getSession in web (cache no-store deliberate); await sendEmail without catch; upgrade better-auth without the ESM migration; delete the CJS peer patch; store the stop flag in after.
## 12. Common mistakes
**Interpretation:** Simplifying Redis away drops L1 plus rate storage plus hook stashes at once; multi-replica correctness falls back to single-process memory and get-session latency regresses.
**Interpretation:** Checking session.user.role for speed works until the first demotion, then enforces stale privilege up to 7d; hierarchy uses it only as actor input with fresh-DB target plus immediate invalidation.
**Interpretation:** Reordering plugins so nextCookies is not last silently breaks Server-Action Set-Cookie propagation; sign-out and delete-user cookie clearing fails with no error.
**Interpretation:** Widening the placeholder-secret exemption for previews signs real sessions with a public repo key.
## 13. Related
Invariants: INV-01, INV-02, INV-06 (pointers only). Flows: flows/auth.md, flows/authenticated-api.md (future). Subsystems: rbac-rules-users.md (verdicts), audit.md (auth sync plane), security.md (boundaries), redis.md (key taxonomy, future). Workflows: change-auth.md (future). ADRs: ADR-0003 secret-free web, ADR-0004 fresh-role, ADR-0007 CJS pin (future).
## 14. Refs
packages/auth/src/server/auth.ts, server/infra/redis.ts, server/pending-storage.ts, server/audit-plugin.ts, server/database-hooks.ts, server/hierarchy.ts, shared/permissions.ts, shared/roles.ts, shared/password-policy.ts, shared/client-ip.ts, config/env.ts, config/load-env.ts, server/email/email-helpers.ts, roles/src/index.ts, database/prisma/models/betterAuth.prisma, patches/better-auth patch, apps/api/src/app.module.ts, common/session.utils.ts.
> **Uncertainty:** Whether active-sessions userId deletion is load-bearing or belt-and-braces is unresolved; reads filter expired entries yet the code deletes it. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4; treat as defense-in-depth and add a Redis-absence test before relying on it.
> **Uncertainty:** Dummy-OAuth test controller path plus OAUTH_TEST_PROVIDER coverage in real envs is untraced in this pass. See FINAL-10-OPEN-QUESTIONS.md Q5; grep compose and hosting env and confirm unset outside tests before touching OAuth wiring.
> **Uncertainty:** audit-plugin in-process maps (pendingRoleChange, pendingUpdateSnapshot, pendingRevokeSingle) have no TTL or sweep for aborted requests. See FINAL-10-OPEN-QUESTIONS.md Q8; prefer finally cleanup or TTL plus size assert, do not assume bounded growth on long-lived workers.
### Session and persistence reference
| Concern | Store | TTL | Fail behavior |
|---|---|---|---|
| Session L1 | Redis bare-token key | session TTL | fall back PG Session row |
| Session truth | PG Session table | 7d expiry | authoritative, audited via hooks |
| Sliding refresh | PG updatedAt throttle | 1d updateAge | bounds write amplification |
| Destructive gate | freshAge check | 15min | delete-user needs recent auth |
| Hook stashes | pending plus deletion plus stop keys | 15-30s GETDEL | memory fallback single-process |
| Rate counters | secondary-storage or database | natural expiry | increment to allow on error |
### Lifecycle event map
| Event | Hook | Audit row | Invalidation |
|---|---|---|---|
| Sign-up | user.create.after | user_signed_up | none |
| Sign-in session | session.create.after | session_created or user_impersonated | none |
| Sign-out revoke | session.delete.before | user_signed_out or stop variant | stashed token |
| Set-role | admin after plus isSuccess | role_changed with from to diff | yes |
| Ban, unban | admin after plus isSuccess | user_banned, user_unbanned | yes |
| Revoke sessions | admin after plus isSuccess | sessions_revoked, session_revoked redacted | yes plus stashed single |
| Remove user | admin after plus isSuccess | user_deleted | yes |
| Self delete | user.delete.after with stash | account_deleted actor null | stashed token plus id |
| Impersonate, stop | create.after, delete.before plus after | started, exactly-one stop | stop path excepted |
### Cookie and email corner reference
**Fact:** useSecureCookies true holds even in dev because nginx terminates TLS in all envs; cookie prefix behavior on plain http localhost is unexercised (e2e uses https 8443).
**Fact:** Verification mail sends on sign-up AND sign-in until verified; reset link TTL 1h, verification 24h per template copy; DEV_EMAIL_OVERRIDE redirects in dev only.
**Fact:** Password hooks cover sign-up email, change-password, and reset-password token redemption; skipping the token path would let emailed-token holders set weak passwords.
### Rate rule reference
| Path family | Budget | Why |
|---|---|---|
| get-session | 300 per min | hottest path, SSR plus focus refetch |
| list-accounts | 60 per min | warm path |
| sign-in email | 5 per min | brute-force bound |
| sign-up email | 3 per min or signup max | enumeration plus abuse bound |
| 2FA verify | 3 per 10s | challenge bound |
| delete-user, remove-user | 2 per min | destructive bound |
### Verification commands
**Fact:** Run package tests for auth plus roles, pnpm --filter api test:integration:all for wiring, and the web e2e auth plus admin slices for browser behavior.
**Fact:** Strict suite forces canSendEmail true with dummy resend mock; oauth suite sets OAUTH_TEST_PROVIDER 1 with in-process dummy provider; default suite stays relaxed for speed.
**Recommendation:** Re-pin the secondaryStorage key-shape comment to the installed better-auth version on every upgrade, and extend the runner-contract style assertion to session keys if one exists for JWT.
**Recommendation:** Never unify me/role versus me/permissions semantics; the split already fixed the has-permission impersonation bug once.
