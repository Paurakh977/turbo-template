---
title: "ADR-0004 Fresh Role Not Snapshot"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/rbac-rules-users.md"]
sources: ["apps/api/src/common/authorization.service.ts", "packages/roles/src/index.ts", "packages/auth/src/shared/permissions.ts", "packages/auth/src/server/pending-storage.ts", "packages/auth/src/server/hierarchy.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/10-ui-enforcement.md", "flows/authenticated-api.md", "subsystems/rbac-rules-users.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0004 Fresh Role Not Snapshot
> Up: ../00-INDEX.md | Status: accepted | Routes T1 T2 T4 T10.
## Status
- Fact: Accepted. Authorization verdicts read getFreshRoleRaw from PG per request, never session snapshot. See apps/api/src/common/authorization.service.ts 82-92.
## Context / Problem
- Fact: Session role is a Redis-cached snapshot with 7d TTL. Demotion or ban is ignored until refresh, opening a stale-elevation window rated Critical in FINAL-07.
- Interpretation: Per-request PG read costs one indexed lookup but closes elevation that any cache re-opens silently.
- Fact: Hierarchy plus parseRoles plus invalidateUserCache coordinate effective role. See packages/roles/src/index.ts plus packages/auth/src/server/hierarchy.ts plus pending-storage.ts 285-318.
## Decision
- Fact: Keep single getFreshRoleRaw effectiveUserId call per request ALS-memoized, branch only on effectiveRole, plus invalidateUserCache on success-only mutations plus exactly-once stop.
- Recommendation: New service code MUST call assertPermission with effectiveRole plus ownership check, MUST NOT read session.user.role or browser role.
- Fact: Admin mutations write audit before stash and invalidate after success. See packages/auth/src/server/audit-plugin.ts pattern.
## Rejected alternatives
- Trust session.user.role directly: saves PG read per request but honors demoted or banned roles until TTL expiry. Rejected for stale elevation until refresh.
- Module-level TTL role cache keyed by userId: saves repeated PG reads within TTL but recreates the same bug globally including banned users. Rejected for global stale window.
- JWKS or JWT role claim cache: removes PG from hot path but cannot observe DB revocation without short expiry plus refresh complexity. Rejected for revocation lag plus key complexity.
## Consequences
- Fact: Positive demotions and bans take effect at latest next request, ownership stays server-enforced. Negative one PG lookup per request adds p99 cost that pool math must absorb.
- Interpretation: UI role badges stay presentational; me/permissions verdict stays authoritative per INV-010.
## Revisit-when
- Recommendation: Revisit only on proven PG role-read p99 breach with ALS-safe per-request memo proof and invalidation proof. Then new ADR, never silent cache.
## Related invariants and implementation
- Recommendation: Constrained by INV-002 fresh-role plus INV-010 enforced versus presentational. Traversed by flows/authenticated-api.md. Owned by subsystems/rbac-rules-users.md.
- Fact: Refs apps/api/src/common/authorization.service.ts plus packages/roles/src/index.ts parseRoles plus permissions.ts ADMIN_PLUGIN_ROLES plus hierarchy.ts.
- Uncertainty: active-sessions deletion load-bearing versus belt-and-braces is unresolved. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q4. Reads filter expired, do not assume deletion enforces.
- Uncertainty: Grant-role settingsThemeGrant pattern not exercised by Notes. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S8. Consult 05 before use.
## Verification
- Fact: Verify with rbac-matrix plus admin-mutations plus stop-impersonation-audit specs plus grep no session.user.role in api/src before merge.
