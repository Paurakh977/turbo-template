---
title: "Presentation Is Not Enforcement"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/web-auth-admin.md"]
sources: ["apps/web/src/lib/server/require-admin.ts", "apps/web/src/lib/auth/auth-client.ts", "apps/web/src/app/dashboard/_components/DashboardShell.tsx", "apps/web/src/app/admin/_components/AdminUserTable.tsx", "apps/api/src/users/users.controller.ts", "apps/api/src/common/authorization.service.ts"]
depends_on: ["decisions/ADR-0004-fresh-role-not-snapshot.md", "flows/authenticated-api.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-010 Presentation Is Not Enforcement
> Up: ../00-INDEX.md
**ID:** INV-010
## Invariant
- Fact: UI hiding MUST never replace server verdicts; every mutation MUST assert on fresh role server-side while `me/role` versus `me/permissions` split stays unmerged.
## Why
- Fact: Browser checks are bypassable via curl; unifying display and verdict endpoints confuses chrome visibility with enforcement principal (FINAL-07 Critical-03).
## Code
- Fact: `apps/web/src/lib/server/require-admin.ts` redirect plus `DashboardShell.tsx` hide plus `AdminUserTable.tsx` row gating are presentational only with debounced 60s fresh-role poll.
- Fact: `apps/api/src/users/users.controller.ts:47-155` keeps `me/role` session-user display separate from `me/permissions` effective-user verdict; `apps/api/src/common/authorization.service.ts` asserts every mutation deny-by-default.
- Fact: `apps/api/src/notes/notes.service.ts` permission plus ownership plus superAdmin-delete plus `apps/api/src/audit/audit.service.ts:244-255` admin gate enforce server-side.
## Consequences
- Fact: Hidden buttons stay hidden for UX but curl without permission still gets 401 or 403; impersonated views never leak admin chrome as authority.
## Naive failure mode
- Interpretation: Hiding button and assuming safe or unifying `me` endpoints or branching enforcement on session role hands verdict to forgeable client state.
## Guards-tests
- Fact: Run `notes-rbac` plus e2e rbac plus `admin-mutations`; verify operator gets 403 on every `/admin/*` route, not just UI hiding.
- Fact: For fresh-role source see [02-fresh-role.md](02-fresh-role.md) INV-002 pointer only; this file owns only presentational versus enforced split.
## Related ADRs
- Recommendation: See [ADR-0004 Fresh Role](../decisions/ADR-0004-fresh-role-not-snapshot.md) for display versus verdict principal split.
## Related flows-subsystems
- Recommendation: Enforced in [authenticated-api](../flows/authenticated-api.md); owned by [web-auth-admin](../subsystems/web-auth-admin.md) plus rbac-rules-users.
- Fact: `require-admin.ts` redirects impersonated sessions to dashboard; admin panel stays unreachable while impersonating by session-role check.
- Fact: Grant toggles via `buildRoleSet` stay visibility-only; server hierarchy re-enforces `canActOn` strict greater-than on every call.
- Fact: Server-action safety nets in `admin/actions.ts` plus `dashboard/actions.ts` add rate-limit defense in depth; API re-enforces authoritatively.
- Fact: Web bootstrap fingerprint plus `cache: no-store` prevents cross-user leakage of display role between requests.
