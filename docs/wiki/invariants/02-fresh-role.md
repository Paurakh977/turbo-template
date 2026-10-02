---
title: "Fresh Role, Never Session Snapshot"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/rbac-rules-users.md"]
sources: ["apps/api/src/common/authorization.service.ts", "packages/roles/src/index.ts", "packages/auth/src/shared/permissions.ts", "packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/hierarchy.ts"]
depends_on: ["decisions/ADR-0004-fresh-role-not-snapshot.md", "flows/authenticated-api.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-002 Fresh Role, Never Session Snapshot
> Up: ../00-INDEX.md
**ID:** INV-002
## Invariant
- Fact: Verdicts MUST re-read PG role per request via `getFreshRoleRaw(getEffectiveUserId(session))`; MUST NOT branch on `session.user.role` or browser role.
## Why
- Fact: Session role is Redis-cached snapshot with 7-day TTL and 86400 updateAge; trusting it keeps demoted or banned users elevated until expiry (FINAL-07 Critical-02).
## Code
- Fact: `apps/api/src/common/authorization.service.ts:82-92` fresh `db.user.findUnique({ role })` plus ALS memo; `packages/roles/src/index.ts` `parseRoles` plus `canActOn` plus `ROLE_WEIGHT`.
- Fact: `packages/auth/src/shared/permissions.ts` single `statement` plus `ac` plus `ADMIN_PLUGIN_ROLES`; `packages/auth/src/server/hierarchy.ts` `enforceRoleHierarchyWithSession` strict greater-than.
- Fact: `packages/auth/src/server/pending-storage.ts:285-318` `invalidateUserCache` deletes bare token plus active-sessions on success only.
### Folded INV-013 invalidate-success-only plus exactly-once stop
- Fact: Invalidate runs after `isSuccess` gate only, never on failure; stop-impersonation uses before-store plus GETDEL pop plus after-write for exactly one row.
- Fact: No module-level role or JWKS or session TTL caches exist; ALS memo only per request plus `disableSettingJwtHeader` skips per-session sign.
## Consequences
- Fact: Demotion, ban, and revoke take effect on next request; repeated checks in one request collapse to one PG read via memo.
## Naive failure mode
- Interpretation: Replacing fresh read with `if (session.user.role === 'admin')` in notes or audit or users service re-opens stale elevation for every demoted user.
- Interpretation: Adding module `Map<userId, role>` plus TTL recreates the bug globally including banned users.
## Guards-tests
- Fact: Run `notes-rbac` plus `admin-mutations` plus e2e rbac `permissions.spec`; grep must show no `session.user.role` verdict in `apps/api/src`.
## Related ADRs
- Recommendation: See [ADR-0004 Fresh Role](../decisions/ADR-0004-fresh-role-not-snapshot.md) for snapshot versus per-request PG trade-off.
## Related flows-subsystems
- Recommendation: Enforced in [authenticated-api](../flows/authenticated-api.md); owned by [rbac-rules-users](../subsystems/rbac-rules-users.md) plus auth-better-auth.
- Uncertainty: FINAL-10 Q4 `active-sessions-*` deletion load-bearing versus belt-and-braces unconfirmed; see `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md` Q4.
- Uncertainty: FINAL-10 Q8 audit-plugin in-process maps TTL and sweep unverified; long-lived worker leak possible, see FINAL-10 Q8.
