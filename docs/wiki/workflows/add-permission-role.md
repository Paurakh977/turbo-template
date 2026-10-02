---
title: "Workflow: Add Permission and Role"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/rbac-rules-users.md"]
sources: ["packages/roles/src/index.ts", "packages/auth/src/shared/permissions.ts", "packages/auth/src/server/hierarchy.ts", "apps/api/src/common/authorization.service.ts", "apps/api/src/users/users.controller.ts", "apps/web/src/app/admin/_components/AdminUserTable.tsx", "apps/web/src/lib/shared/role-badge.ts", "packages/auth/src/server/audit-plugin.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/10-ui-enforcement.md", "flows/authenticated-api.md", "subsystems/rbac-rules-users.md", "subsystems/web-auth-admin.md", "subsystems/web-runtime.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts", "apps/web/e2e/tests/rbac/permissions.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Add Permission and Role
> Up: ../00-INDEX.md | Use when: new action verb or role tier or hierarchy edge or admin UI gate. Route: T4.
## Purpose
- Fact: Adds one permission statement plus role mapping plus hierarchy plus UI presentation without trusting session snapshot.
- Interpretation: Server verdict is the only enforcement; admin table plus badges are presentation only.
- Recommendation: Land statement plus SCOPES plus hierarchy plus invalidation plus UI plus specs in one PR.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T4 and confirm Required order before diff.
- [ ] Read `../invariants/02-fresh-role.md` never session snapshot plus invalidate on success.
- [ ] Read `../invariants/10-ui-enforcement.md` `me/role` versus `me/permissions` split, do not unify.
- [ ] Read `../flows/authenticated-api.md` hop table guards to fresh-role to service.
- [ ] Read `../subsystems/rbac-rules-users.md` plus `web-auth-admin.md` plus `web-runtime.md`.
- Fact: Trusting `session.user.role` reopens stale elevation until Redis TTL expiry.
## Steps checklist
- [ ] 1. Add statement in `packages/auth/src/shared/permissions.ts` with resource plus verbs.
- [ ] 2. Map verbs in `ADMIN_PLUGIN_ROLES` for user slash operator slash admin slash superAdmin plus grants.
- [ ] 3. Add SCOPES entries in `packages/roles/src/index.ts` with `IsIn` allowlist shape.
- [ ] 4. Update `hierarchy.ts` `canActOn` plus weight only if tier order changes; keep strict greater-than.
- [ ] 5. Add `assign-guard` plus `authorization.service.ts` `getFreshRoleRaw` check at service entry.
- [ ] 6. Confirm `users.controller.ts` `me/role` versus `me/permissions` split stays separate.
- [ ] 7. Update `AdminUserTable.tsx` plus `role-badge.ts` presentation only with `data-testid`.
- [ ] 8. Add `audit-plugin.ts` before plus after pair for `role_changed` with invalidate on success only.
- [ ] 9. Add `rbac-matrix` plus `admin-mutations` plus e2e `permissions` coverage for new verb.
## Commands
```sh
pnpm --filter api test:integration -- -t "rbac-matrix"
pnpm --filter api test:integration -- -t "admin-mutations"
pnpm --filter web test:e2e -- -g "rbac"
pnpm --filter web test:e2e -- -g "permissions"
```
- Fact: `test:integration -t` filters Jest by spec name; `test:e2e -g` filters Playwright by title.
- Fact: Run both matrix plus mutations; one without the other misses invalidation faults.
## Files-areas
| Area | Paths |
|---|---|
| Statement | `packages/auth/src/shared/permissions.ts` plus `ADMIN_PLUGIN_ROLES` |
| Scopes | `packages/roles/src/index.ts` SCOPES 9 entries plus weights |
| Hierarchy | `packages/auth/src/server/hierarchy.ts` strict GT plus self-ban blocks |
| Enforcement | `apps/api/src/common/authorization.service.ts` fresh PG read |
| Admin UI | `apps/web/src/app/admin/*` plus `require-admin.ts` presentational |
## Architectural gates
- Fact: No `session.user.role` branch in api; grep must show zero server trust in snapshot.
- Fact: No UI-only gate; every hidden button still has service `assertPermission` behind it.
- Fact: Audit pair writes only on `isSuccess` plus invalidates user cache once.
- Fact: `me/role` versus `me/permissions` never unified into one endpoint.
## Tests
- Fact: Required `rbac-matrix` plus `admin-mutations` plus e2e `permissions` plus `audit-plugin` pair test.
- Fact: Required grep `session.user.role` absent in `apps/api/src`; UI badge snapshot updated per role.
- Fact: Recommended `notes-rbac` regression to catch scope bleed into existing domain.
## Documentation updates
- Fact: Same PR updates `subsystems/rbac-rules-users.md` plus `reference/audit-events.md` deltas for `role_changed`.
- Fact: Same PR updates `extension/seam-catalog.md` grants plus `00-INDEX.md` only if new seam tier added.
- Fact: Bump `updated` plus run link lint; never copy full permission JSON into docs.
## Verification
- [ ] Matrix plus mutations plus e2e rbac all green on default plus strict configs.
- [ ] Grep `session.user.role` in api returns no enforcement branch.
- [ ] Admin table shows new verb only to entitled roles; direct API 403 for others.
- [ ] Audit `role_changed` row present once per success with invalidate observed.
## Failure-recovery
- Fact: Wrong weight maps to follow-up hierarchy fix plus matrix rerun; never hot-patch roles in DB alone.
- Fact: Missing invalidate maps to add `invalidateUserCache` on success path plus `admin-mutations` proof.
- Fact: UI leak maps to keep server gate and fix presentation; UI hide is never a security fix.
- Uncertainty: FINAL-10 Q1 e2e prefix drift may mask rbac e2e 403 shape; verify stub suite, see FINAL-10 Q1.
## Related
- Fact: Up `../00-INDEX.md`; routes T4; enforced by INV-002 plus INV-010.
- Recommendation: Domain wiring continues in `add-domain-module.md`; session lifecycle in `change-auth.md`.
- Recommendation: Hierarchy edge cases in `../subsystems/rbac-rules-users.md` strict GT section.
