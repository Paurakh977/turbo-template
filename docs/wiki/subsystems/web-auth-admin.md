---
title: "Subsystem: Web Auth and Admin (Client, Dashboard, Console)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/web-auth-admin.md"]
sources: ["apps/web/src/lib/auth/auth-client.ts", "apps/web/src/app/auth/page.tsx", "apps/web/src/app/auth/two-factor/page.tsx", "apps/web/src/app/dashboard/layout.tsx", "apps/web/src/app/dashboard/page.tsx", "apps/web/src/app/dashboard/actions.ts", "apps/web/src/app/dashboard/_components/DashboardShell.tsx", "apps/web/src/app/admin/layout.tsx", "apps/web/src/app/admin/page.tsx", "apps/web/src/app/admin/actions.ts", "apps/web/src/app/admin/_components/AdminUserTable.tsx", "apps/web/src/lib/server/require-admin.ts", "apps/web/src/lib/shared/role-badge.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/10-ui-enforcement.md"]
guards: ["apps/web/src/lib/shared/role-badge.spec.ts", "apps/web/e2e/tests/admin/admin.spec.ts", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Web Auth and Admin (Client, Dashboard, Console)
> Up: ../00-INDEX.md | Depends on: INV-02 (fresh role), INV-10 (presentational versus enforced). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Client owned by `apps/web/src/lib/auth/auth-client.ts` (285 lines, baseURL plus plugins plus 429 classifier) plus shared `auth-errors.ts` plus `validation.ts` plus `role-badge.ts` plus `auth-rate-limit-event.ts`.
**Fact:** Auth pages owned by `app/auth/page.tsx` (638 lines, signin signup verify) plus `forgot-password` plus `reset-password` plus `verify-email` plus `two-factor` plus `error.tsx`.
**Fact:** Dashboard owned by `dashboard/layout.tsx` plus `page.tsx` plus `actions.ts` plus `DashboardShell.tsx`; admin owned by `admin/layout.tsx` plus `page.tsx` plus `actions.ts` plus `AdminUserTable.tsx` plus `audit/page.tsx`.
**Recommendation:** Change auth UI only here with shared validators; enforcement lives in API tier, never in these components.
## 2. Runtime
**Fact:** `auth-client.ts:157-162` baseURL is `window.location.origin` on client else `NEXT_PUBLIC_APP_URL` or `BETTER_AUTH_URL` or localhost fallback; SSR fallback never used for real fetch.
**Fact:** `createAuthClient` uses `basePath AUTH_BASE_PATH` from `@repo/auth/permissions` single source plus `refetchOnWindowFocus true` plus `twoFactorClient` plus `adminClient` with `ADMIN_PLUGIN_ROLES`.
**Fact:** `dashboard/layout.tsx:22-32` calls `getRequestBootstrap(h)` then `throwUnlessAuth`, redirects missing userId to auth; one cached bootstrap serves layout plus pages.
**Fact:** `requireAdmin()` in `require-admin.ts:70-102` uses cached get-session via fingerprint primitives, redirects no-session to auth, impersonated to dashboard, non-admin to dashboard.
## 3. Public API
| Symbol | Contract | Source |
|---|---|---|
| authClient.signIn.email | trim email, verbatim password, callback dashboard | app/auth/page.tsx:125-174 |
| authClient.signUp.email | trim email name, policy check, verify-email mode | app/auth/page.tsx:125-174 |
| getFreshRoleAction | parallel bootstrap plus rate dashboard fresh-role failOpen true | dashboard/actions.ts:15-58 |
| requireAdmin | cached session plus role plus impersonation guard | require-admin.ts:70-102 |
| resendVerificationEmailAction | parallel requireAdmin plus rate, hierarchy, unauth send | admin/actions.ts:48-117 |
**Fact:** Passwords sent verbatim never trimmed; emails and names trimmed; logout is client `authClient.signOut` then hard navigate to auth via DashboardShell.
## 4. Dependency direction
**Fact:** Allowed: pages into `auth-client.ts` plus shared validators plus `app-url.ts`; layouts plus actions into `getRequestBootstrap` plus `requireAdmin` plus `callInternalApi`; table into browser `authClient.admin` plus server resend action.
**Fact:** Forbidden: web MUST NOT instantiate Better Auth runtime; only `import type Auth` plus pure subpaths `roles`, `permissions`; no direct DB calls.
| Check | Grep |
|---|---|
| No runtime auth | rg -n "from '@repo/auth'" apps/web/src, expect only type or subpath |
| Single hierarchy | rg -n canActOn packages/auth/src apps/web/src, expect shared roles only |
| No token persist | rg -n token apps/web/src/app/dashboard/page.tsx, expect strip only |
**Recommendation:** New auth UI MUST reuse shared auth-errors validation app-url; never inline policy strings.
## 5. Security posture
**Fact:** Rate classifier in `auth-client.ts:38-95` splits PASSIVE get-session list-accounts, AUTH_CHALLENGE signin signup verify 2FA, HANDLED_PER_CALL admin mutations, else destructive; passive never toasts, handled suppresses double toast.
**Fact:** `notifyRateLimit` throttled 5s dispatches `AUTH_RATE_LIMIT_EVENT` with Retry-After delta seconds; HTTP-date falls back undefined; parse fail defaults destructive safer.
**Fact:** Forgot plus resend are enumeration-safe: success for unknown, error only throttling or availability; resend without headers avoids EMAIL_MISMATCH oracle in admin path.
**Fact:** `AdminUserTable.tsx:317-319` gates `canAct` on self-exclusion plus `canActOn(actorRole,userRole)`; assignable roles superAdmin 3 versus admin 2; server re-checks hierarchy.
## 6. Failure modes
**Fact:** First-load 429 with no cache shows RetryScreen exponential 5s times 2^n max 60s; degraded cached plus 429 shows DegradedBanner, never login redirect.
**Fact:** `getFreshRoleAction` returns null on bootstrap fail non-401 (logged, not auth masquerade) and on rate deny; UI degrades to session role, enforcement stays server-side.
**Fact:** Two-factor missing challenge 401 or 403 shows expired to auth; session present routes to dashboard; backup maxLength 20 versus totp 6 by design.
**Fact:** Admin page out-of-range clamps to last page with second fetch costing 2 HTTP; client search filters only current 50 rows, not full total.
## 7. Performance
**Fact:** `getSessionCached=cache()` in `require-admin.ts:35-49` collapses layout plus page 2x get-session to 1 HTTP; Headers object would defeat cache so primitives only.
**Fact:** `DashboardShell.tsx:76-106` polls fresh role on mount plus focus visibility debounced 60s via lastRefreshRef; before debounce rapid flapping fired 3 HTTP per event.
**Fact:** `dashboard/page.tsx:32-33` sessionStorage dash-session TTL 5min strips token ipAddress userAgent; live session wins over cached; accounts fetched once per mount.
**Fact:** Fresh-role poll wall cost is bootstrap plus rate-check parallel 2 HTTP; reads failOpen true must not degrade UI on limiter blip.
## 8. Config/Env
**Fact:** Callback URLs built via `buildAbsoluteUrl(getAppBaseUrl(h) or getClientAppBaseUrl, path)`; server `inferOriginFromHeaders` uses x-forwarded-proto plus host, http for localhost else https.
**Fact:** OAuth providers google github use `disableRedirect true` with callback appUrl dashboard plus errorCallback auth; error params safeDecodeParam double-decode guard then history replaceState.
**Fact:** Two-factor challenge snapshot `ba:two-factor-challenge` in sessionStorage TTL 10min; server challenge TTL alignment unverified, treat as UX hint only.
**Recommendation:** Never concat URLs; keep basePath sourced from permissions package; keep 60s debounce on fresh-role poll.
## 9. Testing/verification
**Fact:** `role-badge.spec.ts` plus `validation.spec.ts` plus `auth-errors.spec.ts` cover style fallback, email policy, safe decode; run pnpm filter web test.
**Fact:** Playwright `e2e/tests/admin/admin.spec.ts` plus `auth` plus `rbac/permissions` prove writer gates, 403 on plain user, impersonation stop; run test e2e admin slice.
**Fact:** `request-fingerprint.spec.ts` plus `bootstrap.spec.ts` prove byte-identical cache keys between bootstrap and requireAdmin; run web unit.
**Recommendation:** After auth UI or guard change run web unit plus e2e auth plus admin plus rbac plus guard web-auth-imports.
## 10. Extension pointer
**Recommendation:** Add admin segment by calling requireAdmin in layout, setting force-dynamic, adding error plus loading, listing via listUsersFromApi with limit 50.
**Recommendation:** Add auth endpoint handling by classifying it passive challenge handled or destructive in auth-client classifier same PR.
**Recommendation:** Add role-gated UI by using getPrimaryRole hasAdminRole hasOperatorRole canActOn from shared roles, never permission strings in guards.
## 11. AI-guidance
MUST: gate UI on role tokens not permission strings; enforce on server via AuthorizationService plus evaluateAppPermissions plus admin plugin canActOn.
MUST: keep resend WITHOUT headers in admin path; keep fresh-role failOpen true and mutations false; keep sessionStorage secrets stripped.
MUST-NOT: trust session user role for verdicts; trust client impersonatedBy; widen CLIENT_AUDIT_ACTIONS to security events; add AllowAnonymous to mutations.
## 12. Common mistakes
**Interpretation:** Trusting fresh-role poll for enforcement reopens stale window when limiter blips return null; poll is presentational only, API verdict is source of truth.
**Interpretation:** Forwarding cookies in admin resend creates EMAIL_MISMATCH oracle leaking existence; unauthenticated send without headers is enumeration-safe by design.
**Interpretation:** Adding permission-proxy checks in requireAdmin drifts when permissions reassigned; role-token checks avoid reassignment drift per comment 54-58.
**Interpretation:** Persisting token or IP or UA to sessionStorage exposes secrets to XSS and devtools; strip before persist per dashboard page comment.
## 13. Related
Invariants: INV-02 fresh role, INV-10 presentational versus enforced pointers only. Flows: flows/auth.md, flows/authenticated-api.md future. Subsystems: web-runtime.md, rbac-rules-users.md, auth-better-auth.md, security.md. Workflows: add-permission-role.md, change-auth.md future. ADRs: ADR-0004 fresh role future.
## 14. Refs
apps/web/src/lib/auth/auth-client.ts, apps/web/src/app/auth/page.tsx, apps/web/src/app/auth/forgot-password/page.tsx, apps/web/src/app/auth/reset-password/page.tsx, apps/web/src/app/auth/verify-email/page.tsx, apps/web/src/app/auth/two-factor/page.tsx, apps/web/src/app/dashboard/layout.tsx, apps/web/src/app/dashboard/page.tsx, apps/web/src/app/dashboard/actions.ts, apps/web/src/app/dashboard/_components/DashboardShell.tsx, apps/web/src/app/admin/layout.tsx, apps/web/src/app/admin/page.tsx, apps/web/src/app/admin/actions.ts, apps/web/src/app/admin/_components/AdminUserTable.tsx, apps/web/src/lib/server/require-admin.ts, apps/web/src/lib/server/request-fingerprint.ts, apps/web/src/lib/shared/role-badge.ts, apps/web/src/lib/shared/auth-errors.ts, apps/web/src/lib/shared/validation.ts.
> **Uncertainty:** Dummy OAuth controller path plus OAUTH_TEST_PROVIDER unset in real envs is untraced; test-only provider must never run in prod. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q5; grep compose plus hosting env plus controller trace before touching OAuth wiring.
> **Uncertainty:** Resend plus dummy-OAuth plus host-rewrite edge cases assume CIDR versus hop agreement that breaks if load balancer added. See FINAL-10-OPEN-QUESTIONS.md Q13; open ADR when topology changes, do not patch ad hoc.
| Endpoint class | Examples | UX |
|---|---|---|
| passive | get-session list-accounts list-users | silent inline |
| challenge | sign-in sign-up verify 2FA | inline per page |
| handled | set-role ban impersonate remove | per-call toast |
| destructive | default | global toast |
**Fact:** Classification prevents double-toast bug class; passive silent relies on useSession error status.
**Recommendation:** Keep this file 120-200 lines; link invariants, never copy rules; bump updated on every content PR.
| Role | Badge | Can manage |
|---|---|---|
| superAdmin | primary | user operator admin |
| admin | primary | user operator |
| operator | indigo | none via table |
| user | muted | none |
### Verification commands
**Fact:** Run web unit for badge plus validation, e2e admin plus auth plus rbac for presentational gates, guard web-auth-imports for runtime import.
**Recommendation:** New admin mutation MUST add e2e 403 plus hierarchy plus invalidation coverage same PR.
| Bootstrap field | Source | Note |
|---|---|---|
| userId effective | users me bootstrap | impersonated target |
| role session | session user role | UI hint stale 7d |
| effectiveRole | fresh PG read | enforcement |
| permissions | evaluateAppPermissions | notes settings |
**Fact:** Code wins over wiki; users controller plus auth-client plus requireAdmin win over prose.
**Recommendation:** Extend bootstrap query for new identity needs, never add round trips.
**Fact:** Me role is session user while me permissions is effective user; do not unify per controller comment.
**Recommendation:** Keep impersonation blocked on admin routes even for admins per requireAdmin comment.
**Fact:** Audit trace for admin resend has no web row; whether API logs email event server-side needs API verify.
**Recommendation:** Keep dashboard cards presentational; enforcement never depends on fresh-role poll.
**Fact:** OAuth callback error params handling duplicated home plus auth page; unify beyond safeDecodeParam when touched.
**Fact:** E2E users seed four role accounts with storage states; never randomize e2e emails.
**Recommendation:** Keep workers 1 fullyParallel false; parallel roles race rate buckets.
