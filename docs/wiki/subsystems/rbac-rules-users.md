---
title: "Subsystem: RBAC Rules and Users Boundary"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/rbac-rules-users.md"]
sources: ["packages/roles/src/index.ts", "packages/auth/src/shared/permissions.ts", "packages/auth/src/server/hierarchy.ts", "apps/api/src/common/authorization.service.ts", "apps/api/src/users/users.controller.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/10-ui-enforcement.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts", "packages/auth/src/shared/permissions.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: RBAC Rules and Users Boundary
> Up: ../00-INDEX.md | Depends on: INV-02 (fresh role), INV-10 (presentational versus enforced). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Policy definition owned by packages/roles/src/index.ts (tokens, weights, predicates, SERVER_ACTION_SCOPES) plus shared/permissions.ts (statement, ac, ADMIN_PLUGIN_ROLES); cross-target guards by hierarchy.ts plus audit-plugin.ts before-hooks.
**Fact:** Verdict computation owned by apps/api/src/common/authorization.service.ts (evaluateAppPermissions, assertPermission, getFreshRoleRaw); domain application by notes.service.ts; identity surface by users.controller.ts (156 lines, me/role versus me/permissions versus me/bootstrap).
**Fact:** Presentation mirrors never gates live in require-admin.ts, app/admin paths, app/dashboard paths, role-badge.ts; UI tier detail in subsystems/web-auth-admin.md (future).
## 2. Runtime
**Fact:** Roles are a set encoded as comma string: exactly one base role (user 0, operator 1, admin 2, superAdmin 3 by ROLE_WEIGHT) plus zero or more grant tokens (settingsThemeGrant, settingsLabsGrant); parseRoles accepts comma strings, arrays, JSON arrays, dollar-value shapes, trims, dedups, normalizes (max weight wins, empty to user); serializeRoles is the DB canonical form.
**Fact:** Every mutation resolves roleRaw from getFreshRoleRaw(getEffectiveUserId(session)) (one db.user.findUnique role per request per user, ALS-memoized) then assertPermission(roleRaw, resource, action); session snapshot is never a verdict input (narrow exception: actor-side input to hierarchy comparison, paired with fresh-DB target plus immediate invalidation).
**Fact:** Hierarchy is strict greater-than: canActOn(actor,target) is maxWeight actor above maxWeight target; peers cannot touch peers; assign-guards reject granting at or above own weight on set-role, update-user role, create-user role.
**Fact:** Notes splits permission from ownership: effective role answers can-you-touch-notes, session identity answers whose-notes (listForSession non-operator branch scopes to authorId session.user.id); remove requires notes delete, which only superAdminRole carries.
## 3. Public API
| Endpoint | Answers | Principal | Source |
|---|---|---|---|
| GET api/users/me/role | Session user fresh DB role (chrome visibility) | session user | users.controller.ts |
| GET api/users/me/permissions | Effective user evaluated permissions (enforcement verdict) | effective user | users.controller.ts:60-71 |
| GET api/users/me/bootstrap | Both in one HTTP plus one guard resolution | both | users.controller.ts:73-82 |
**Fact:** UsersModule provides only AuthorizationService, no separate users service; identity reads are thin wrappers over fresh-role plus evaluation.
**Fact:** evaluateAppPermissions unions over tokens with the same ac objects as auth config; exactly one policy definition imported by both auth.ts and authorization.service.ts.
## 4. Dependency direction
**Fact:** Allowed: authorization.service.ts into roles parseRoles plus permissions registry; notes.service.ts plus audit.service.ts plus users.controller.ts into AuthorizationService; web Admin table into predicate helpers (canActOn, hasAdminRole, checkRolePermission) for visibility only.
**Fact:** Forbidden: no second statement or role map in apps/api; no verdict from session.user.role or browser snapshot; no admin-panel access from web-only canAct hiding (direct admin client calls re-enforced server-side).
| Check | Grep |
|---|---|
| No session-role verdict | rg -n session.user.role apps/api/src/notes apps/api/src/audit apps/api/src/users, expect only comments and display |
| No forked policy | rg -n createAccessControl apps/api/src packages/auth/src, expect only permissions.ts plus imports |
| Hierarchy covered | rg -n enforceRoleHierarchyWithSession packages/auth/src/server apps/web/src/app/admin |
## 5. Security posture
**Fact:** Vendor gate adminRoles admin plus superAdmin (auth.ts:581-589) is the only admin-panel gate; operator and grant tokens are AC-map members but never panel members, so granting operator never opens user management.
**Fact:** Self-ban and self-delete-via-admin blocked BAD_REQUEST and audited (user_ban_blocked, user_delete_blocked); nested impersonation blocked FORBIDDEN; self-delete via delete-user requires password for credential accounts.
**Fact:** Client audit writes allowlisted (profile_updated, theme_changed, labs_toggled) with 4096-char cap, and audit-metadata.ts strips impersonatedBy before server markers stamped, so attribution cannot be forged over HTTP (detail in subsystems/audit.md).
## 6. Failure modes
**Fact:** Stale session after demotion: verdicts stay correct via PG re-read; only presentational chrome (useSession, bootstrap seed) can lag one poll cycle about 60s debounced freshRole, safe because enforcement never consults it.
**Fact:** Missing role row or unknown token: getFreshRoleRaw falls back user, parseRoles falls back user list, getMaxRoleWeight maps unknown to 0, deny-by-default never crash.
**Fact:** ALS absent (background, tests without middleware): memo skipped, direct DB read used; repeated checks cost extra reads but stay correct.
**Fact:** Assign-guard versus target-guard skew: both must stay strict (greater-than target, at-or-above assign); relaxing either lets an admin clone its own weight onto a controlled account and gain peer immunity.
## 7. Performance
**Fact:** One findUnique role per request per user via ALS roleCache (versus 2-3 before on PATCH notes); bootstrap coalesces session plus effective reads (non-impersonated 1 read, impersonating 2 in parallel).
**Fact:** Evaluation is local (authorize over handful tokens times APP_RESOURCES notes plus settings actions), no extra IO beyond the single role read.
**Fact:** Web freshRole poll rate-bounded (dashboard:fresh-role 30/min fail-open) debounced 60s silent degrade; dashboard list uses withTotal false lean mode to skip COUNT probe.
## 8. Config/Env
**Fact:** No env owns policy; roles and statements are code (roles package, permissions.ts) not env flags; adding a permission is a code change with migration-free deploy (see section 10).
**Fact:** SERVER_ACTION_SCOPES 9 scopes (notes star, settings star, admin resend-verification, dashboard fresh-role) is the single source for POST api/rate-limit/check; unknown scopes 400 preventing unbounded Redis keys.
**Fact:** Seed and e2e users deterministic (user, operator, admin, superadmin at test.local); new roles added to seed plus e2e plus assignableRoles together.
## 9. Testing/verification
**Fact:** Unit: roles index.spec.ts (parse plus weights plus canActOn), permissions.spec.ts registry shape, hierarchy.spec.ts strict greater-than, session.utils.spec.ts, request-context.spec.ts per-request memo.
**Fact:** Integration: notes-rbac (401 plus 403 plus ownership plus withTotal), admin-mutations (invalidation on success only), users, attack-surface; run pnpm --filter api test:integration:all for any role, permission, hierarchy, or users-boundary change.
**Fact:** E2E rbac permissions.spec.ts plus admin.spec.ts under impersonation and non-impersonation; k6 edge-cases-flow covers 400 plus 401 plus 403 plus 404 plus 429 shapes.
**Recommendation:** Add contract tests: operator credentials 403 on every admin path after each better-auth bump; me/role versus me/permissions divergence under impersonation; grant toggle preserves canActOn outcomes.
## 10. Extension pointer
**Recommendation:** Add a permission by extending statement plus owning role in permissions.ts, wiring assertPermission in the service, updating assignableRoles derivation, adding notes-rbac plus admin-mutations plus e2e rbac coverage; see workflows/add-permission-role.md (future).
**Recommendation:** Add a role with base token plus ROLE_WEIGHT plus registry entry, deciding adminRoles membership explicitly (default not a panel role), plus the operator-to-admin 403 matrix assertion.
**Recommendation:** Never hardcode new assignableRoles arrays; derive from ROLE_WEIGHT plus canActOn so a future base role cannot drift the UI allowlist.
## 11. AI-guidance
MUST: compute verdicts from getFreshRoleRaw(getEffectiveUserId(session)); keep me/role session and me/permissions effective split; keep hierarchy strict greater-than plus assign-guard at-or-above; keep grants zero weight; keep one shared ac object set.
MUST-NOT: branch on session.user.role; merge the two me endpoints; add operator to adminRoles; add grant names to ROLE_WEIGHT; cache roles across requests; gate admin UI on me/permissions effective instead of session role.
## 12. Common mistakes
**Interpretation:** Unifying the two endpoints repeats the has-permission bug the split fixed: merged toward session mis-evaluates impersonation; merged toward effective leaks admin chrome into impersonated views.
**Interpretation:** Moving hierarchy checks into web tier only leaves direct admin client calls unguarded; AdminUserTable canAct hiding is visibility, not access control.
**Interpretation:** Forking a small statement in apps/api for clarity guarantees silent divergence at the next edit on either side; import the same objects.
**Interpretation:** Caching bootstrap with fetch caching leaks per-user sessions across requests; codebase uses cache no-store plus per-request React cache plus per-request ALS deliberately.
## 13. Related
Invariants: INV-02, INV-10 (pointers only). Flows: flows/authenticated-api.md (future). Subsystems: auth-better-auth.md (session mechanics), audit.md (attribution), security.md (boundaries), web-auth-admin.md (presentation, future). Workflows: add-domain-module.md, add-permission-role.md (future). ADRs: ADR-0004 fresh-role (future). Reference: audit-events.md, test-matrix.md (future).
## 14. Refs
packages/roles/src/index.ts, shared/permissions.ts, shared/roles.ts, server/hierarchy.ts, server/audit-plugin.ts, common/authorization.service.ts, notes/notes.service.ts, notes/notes.controller.ts, users/users.controller.ts, users/users.module.ts, common/session.utils.ts, common/request-context.ts, common/request-context.interceptor.ts, require-admin.ts, bootstrap.ts, role-badge.ts, admin/_components/AdminUserTable.tsx.
> **Uncertainty:** notes.service.ts tails beyond line 140 (update-ownership branch, delete path) were grep-verified, not fully read; re-confirm the hasAdminRole bypass interplay before editing those branches. See .agent/wiki-discovery/05-authorization-rbac.md section 17.
> **Uncertainty:** active-sessions invalidation immediacy is belt-and-braces until proven load-bearing since reads filter expired entries. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4; keep the explicit delete, do not rely on it as the sole revocation proof.
### Role semantics reference
| Role | Admin panel | Notes | Settings | Weight |
|---|---|---|---|---|
| user | no | none | read profile security | 0 |
| operator | no, not in adminRoles | list create update | plus theme | 1 |
| admin | yes | list create update no delete | plus theme labs plus admin statements | 2 |
| superAdmin | yes plus impersonate-admins | plus delete | same as admin | 3 |
| settingsThemeGrant, settingsLabsGrant | no, grant tokens | none | plus theme or labs additive | 0 |
**Fact:** Operator is a domain role, not an admin-panel role; AC-map membership never equals endpoint access.
**Fact:** Grants never change base role and never confer weight; canActOn ignores them so a grant cannot escalate hierarchy standing.
### Evaluation and freshness reference
**Fact:** evaluateAppPermissions parses once then checks every resource times action pair against any token authorize success; writers canonicalize via serializeRoles so comma, array, and JSON inputs converge.
**Fact:** Better Auth own has-permission does raw split comma with exact-token lookup and no trim; app evaluation intentionally does not mirror that quirk and stays trim and dedup safe (boundary contract in authorization.service.ts).
**Fact:** Freshness chain is mutation into invalidateUserCache into next-request Redis miss into guard fresh session into getFreshRoleRaw PG hit; within a request repeated checks collapse to one findUnique via the memo.
### Users boundary contract
| Endpoint | Principal | Consumer | Never use for |
|---|---|---|---|
| me/role | session user fresh role | DashboardShell admin chrome | enforcement verdicts |
| me/permissions | effective user evaluated | matches server enforcement | chrome visibility |
| me/bootstrap | both plus impersonatedBy | single round-trip shell | direct DB or session cache |
**Fact:** requireAdmin resolves getSessionFromApi, redirects anonymous to auth, impersonating or non-admin to dashboard; role check uses session snapshot hasAdminRole, presentational only.
**Fact:** DashboardShell freshRole fetched on mount plus focus, debounced 60s, silent degrade; roleRaw is freshRole fallback session role, isAdmin gates the Admin Panel link only.
### Admin table and action reference
**Fact:** AdminUserTable per-row canAct is user id not actor plus canActOn actor role versus target role; assignableRoles are superAdmin to user operator admin, admin to user operator, mirroring the server assign-guard while additionally never offering superAdmin in UI.
**Fact:** Grant toggles use buildRoleSet plus checkRolePermission for theme and labs visibility; all mutations call authClient.admin directly with server re-enforcement and toast surfaces.
**Fact:** resendVerificationEmailAction runs requireAdmin plus checkServerActionRateLimit 5 per min fail-closed in parallel, then getAdminUserFromApi with 404 to null, canActOn with superAdmin elevation, verified-check, then sendVerificationEmailFromApi WITHOUT headers (the authenticated path would throw EMAIL_MISMATCH since admin session email differs from target; the unauthenticated path is enumeration-safe).
### Verification commands
**Fact:** Run roles plus permissions plus hierarchy package specs, notes-rbac plus admin-mutations plus users integration, and e2e rbac plus admin slices for impersonation divergence.
**Recommendation:** Derive assignableRoles from ROLE_WEIGHT plus canActOn instead of hardcoded arrays; a new base role otherwise drifts the UI allowlist silently.
**Recommendation:** Keep the operator-to-admin 403 matrix assertion after every better-auth bump; vendor adminRoles membership is native semantics that upgrades can reinterpret.
**Recommendation:** Confirm audit.service listForAdmin re-checks admin server-side (controller comment implies it) before relying on the listing gate in a new admin surface.
### Ownership clarification
**Fact:** UsersModule stays thin by design: identity reads need no separate service because AuthorizationService plus Prisma cover them; adding a users service would split the verdict path.
**Fact:** Dashboard and admin layouts resolve bootstrap once via getRequestBootstrap and derive a session-shaped object for the shell; no full session lookup happens in layout code.
**Recommendation:** Keep permission checks in services (assertPermission) and ownership scoping beside them; never push verdict logic into controllers or client components.
**Recommendation:** Review grant-token additions against ROLE_WEIGHT zero-weight and canActOn outcomes in the same PR; additive UI tokens must never move hierarchy standing.
### Final contract reminder
**Fact:** Three role values exist per request and must not be confused: session.user.role snapshot, ALS roleCache fresh memo, and browser snapshot; only the middle one feeds verdicts.
**Recommendation:** Keep this file as the verdict owner; session mechanics stay in auth-better-auth.md and evidence rows stay in audit.md.
