---
title: "00 Index Router"
type: index
status: stable
authority: normative-routing
owners: []
sources: [".agent/wiki-discovery/PHASE2-09-TASK-CONTEXT-MATRIX.md", ".agent/wiki-discovery/FINAL-02-AI-CONTEXT-MODEL.md", ".agent/wiki-discovery/FINAL-05-CONTEXT-ROUTING.md"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/04-database-connections.md", "invariants/05-audit-planes.md", "invariants/06-rate-limits.md", "invariants/07-health.md", "invariants/08-observability.md", "invariants/09-env.md", "invariants/10-ui-enforcement.md"]
guards: []
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# 00 Index Router

> Self-root: this file is the wiki entry point and carries no Up link.

## What this wiki is

- Fact: This wiki is AI memory plus router, not a copy of code. Source of truth stays in code, schema plus migrations, roles plus permissions, env example plus validators, and compose plus nginx. See .agent/wiki-discovery/FINAL-02-AI-CONTEXT-MODEL.md S4 and apps/api/src/main.ts for bootstrap order.
- Interpretation: Read the router, then read only the task row in order. Open search reproduces stale-role and pooled-migrate bugs.
- Recommendation: Never read the whole wiki. Follow exactly one task route Required order, then open only files named by that route.

## First-read path

- Fact: Normative 5-step path from .agent/wiki-discovery/PHASE2-13-IMPLEMENTATION-BLUEPRINT.md S4.
- Recommendation: Follow in order and stop at each exit check.

| Step | Read | Exit check |
|---|---|---|
| 1 | AGENTS.md in 30s: identity plus invariants plus code-wins | Recite Arch-B plus fresh-role plus pooler versus direct |
| 2 | 00-INDEX.md in 2min: this router plus headlines plus task row | Task row T1-T10 identified |
| 3 | Blocking invariants only in 3min: 2-4 files bound to task | State what merge would block |
| 4 | Task route flows plus subsystems plus workflows in Required order | Hop files listed, Recommended only if adjacent |
| 5 | Code at exact paths named by flow and workflow | Diff touches only listed owners plus tests |

## Task router

- Fact: Required equals MUST before diff. Trimmed from .agent/wiki-discovery/PHASE2-09-TASK-CONTEXT-MATRIX.md S3. Optional and Verification live in workflows plus reference/test-matrix.md.
- Recommendation: Pick exactly one row. Load Required in listed order. Do not preload other rows.

| Task | Required docs in order |
|---|---|
| T1 Add domain via Notes seam | invariants/02-fresh-role.md, invariants/03-request-context.md, invariants/05-audit-planes.md, invariants/10-ui-enforcement.md; flows/authenticated-api.md, flows/audit.md; subsystems/rbac-rules-users.md, subsystems/database-prisma.md, subsystems/web-runtime.md; workflows/add-domain-module.md; extension/notes-canonical-example.md, extension/seam-catalog.md |
| T2 Modify auth and session | invariants/01-architecture-b.md, invariants/02-fresh-role.md, invariants/03-request-context.md, invariants/06-rate-limits.md; flows/auth.md, flows/authenticated-api.md; subsystems/auth-better-auth.md, subsystems/redis.md, subsystems/security.md; workflows/change-auth.md |
| T3 Add DB model and migration and pool | invariants/04-database-connections.md, invariants/05-audit-planes.md; flows/migration.md; subsystems/database-prisma.md, subsystems/database-package.md, subsystems/docker-environments.md; workflows/add-model.md |
| T4 Admin UI plus role and permission | invariants/02-fresh-role.md, invariants/10-ui-enforcement.md; flows/authenticated-api.md; subsystems/rbac-rules-users.md, subsystems/web-auth-admin.md, subsystems/web-runtime.md; workflows/add-permission-role.md |
| T5 Rate limit edge and app and action | invariants/06-rate-limits.md, invariants/07-health.md; flows/rate-limited.md; subsystems/redis.md, subsystems/nginx-edge.md, subsystems/k6-performance.md; workflows/add-rate-limited-action.md |
| T6 Observability SDK and pipeline and alerts | invariants/08-observability.md; flows/observability.md; subsystems/observability-app.md, subsystems/observability-infra.md; workflows/change-observability.md |
| T7 Docker and env and profiles | invariants/07-health.md, invariants/09-env.md, invariants/01-architecture-b.md; flows/migration.md, flows/e2e.md; subsystems/docker-environments.md, subsystems/env-config.md; workflows/change-docker-env.md |
| T8 Debug prod and audit and DLQ redrive | invariants/05-audit-planes.md, invariants/07-health.md, invariants/08-observability.md; flows/audit.md, flows/observability.md; workflows/debug-prod.md, workflows/redrive-dlq.md |
| T9 Perf cluster and pool and Redis and k6 | invariants/04-database-connections.md, invariants/06-rate-limits.md, invariants/08-observability.md; flows/authenticated-api.md, flows/rate-limited.md; subsystems/api-runtime.md, subsystems/k6-performance.md, subsystems/database-package.md; research/2026-09-capacity-notes.md |
| T10 Security hardening and boundary | invariants/01-architecture-b.md, invariants/02-fresh-role.md, invariants/10-ui-enforcement.md; flows/auth.md, flows/authenticated-api.md, flows/audit.md; subsystems/security.md, subsystems/auth-better-auth.md, subsystems/rbac-rules-users.md, subsystems/audit.md; workflows/change-auth.md |

## Invariant headlines

- Fact: Ten normative constraints from .agent/wiki-discovery/PHASE2-13-IMPLEMENTATION-BLUEPRINT.md S6. Full rules live in invariants files. Headlines carry no code by design.
- Recommendation: Read only the 2-4 invariants bound to your task row before flows.

- [Architecture B secret-free web: browser and web server never hold database access or auth secrets](invariants/01-architecture-b.md)
- [Fresh role on every request: verdicts always re-read the database role and never trust the session snapshot](invariants/02-fresh-role.md)
- [Request context lives per request only: single session capture with capture at emit for background work](invariants/03-request-context.md)
- [Pooler for runtime and direct for migrations: client and server pool budgets stay independent and explicit](invariants/04-database-connections.md)
- [Two audit planes: synchronous auth writes and same-transaction outbox for domain writes](invariants/05-audit-planes.md)
- [Three rate-limit layers with no bypass: throttling is expected behavior and health stays throttled](invariants/06-rate-limits.md)
- [Liveness versus readiness split: liveness is dependency free and readiness may report failure](invariants/07-health.md)
- [Observable by default with safe defaults: normalized routes plus per-worker identity plus fail-open telemetry](invariants/08-observability.md)
- [Single env source with fail-fast validation: baked public values versus runtime secrets](invariants/09-env.md)
- [Presentation is not enforcement: interface hiding never replaces server-side permission checks](invariants/10-ui-enforcement.md)
## Flows map

- Fact: Flows are hop narratives from .agent/wiki-discovery/FINAL-05-CONTEXT-ROUTING.md. Each flow header lists Depends-on invariants.
- Recommendation: Read the flow before its subsystems. It names the exact files to open.

| Flow | When to read it |
|---|---|
| [flows/auth.md](flows/auth.md) | Login plus session plus two-factor plus impersonation lifecycle |
| [flows/authenticated-api.md](flows/authenticated-api.md) | Browser to nginx to guards to fresh role to service to database |
| [flows/audit.md](flows/audit.md) | Synchronous auth plane versus outbox domain plane |
| [flows/rate-limited.md](flows/rate-limited.md) | Edge zones to Better Auth rules to Nest scopes |
| [flows/observability.md](flows/observability.md) | SDK to Alloy to backends to Grafana |
| [flows/migration.md](flows/migration.md) | Fragment to migrate image to deploy |
| [flows/e2e.md](flows/e2e.md) | Seed to nginx to Playwright projects |

## Subsystem owners

- Fact: Subsystems own file areas and allowed directions. See .agent/wiki-discovery/PHASE2-13-IMPLEMENTATION-BLUEPRINT.md S8 for the 14-section contract.
- Recommendation: Open subsystems only via your task row. Related links stay in footers.

| Subsystem | Owns |
|---|---|
| [subsystems/api-runtime.md](subsystems/api-runtime.md) | Nest bootstrap plus cluster plus guards plus interceptors |
| [subsystems/auth-better-auth.md](subsystems/auth-better-auth.md) | Session plus persistence plus lifecycle config |
| [subsystems/rbac-rules-users.md](subsystems/rbac-rules-users.md) | Roles plus registry plus hierarchy plus users boundary |
| [subsystems/audit.md](subsystems/audit.md) | Dual planes plus tuning plus redrive plus purge |
| [subsystems/observability-app.md](subsystems/observability-app.md) | App SDKs plus meters plus interceptors |
| [subsystems/observability-infra.md](subsystems/observability-infra.md) | Alloy plus backends plus dashboards plus alerts |
| [subsystems/database-prisma.md](subsystems/database-prisma.md) | Schema plus config plus PgBouncer routing |
| [subsystems/database-package.md](subsystems/database-package.md) | Pool plus seed plus scripts |
| [subsystems/redis.md](subsystems/redis.md) | Keys plus limits plus fail-open behavior |
| [subsystems/nginx-edge.md](subsystems/nginx-edge.md) | Zones plus health exemption plus TLS |
| [subsystems/web-runtime.md](subsystems/web-runtime.md) | Proxy plus gateways plus bootstrap plus boundary |
| [subsystems/web-auth-admin.md](subsystems/web-auth-admin.md) | Client plus dashboard plus admin presentation |
| [subsystems/testing.md](subsystems/testing.md) | Suites plus guards plus change-to-test matrix |
| [subsystems/docker-environments.md](subsystems/docker-environments.md) | Dockerfiles plus profiles plus healthchecks |
| [subsystems/env-config.md](subsystems/env-config.md) | Single source plus validators plus add-var checklist |
| [subsystems/security.md](subsystems/security.md) | Boundaries plus dangerous modifications list |
| [subsystems/k6-performance.md](subsystems/k6-performance.md) | Suites plus thresholds plus methodology |

## Extension pointer

- Fact: Template consumers extend through seams, not forks. See extension docs derived from .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md.
- Recommendation: New domain work starts at the canonical example, then checks the seam catalog.

| Doc | Use |
|---|---|
| [extension/what-stays-vs-evolves-vs-replaced.md](extension/what-stays-vs-evolves-vs-replaced.md) | Stays versus evolves versus replaced table |
| [extension/notes-canonical-example.md](extension/notes-canonical-example.md) | Full vertical Notes example to copy |
| [extension/seam-catalog.md](extension/seam-catalog.md) | Every seam plus transplant rule |

## Research warning

- Fact: Research expires and never blocks merges. Benchmarks rot fastest per .agent/wiki-discovery/FINAL-05-CONTEXT-ROUTING.md perf row.
- Recommendation: Never default to research. Load it last and only for T9 perf work.

| Doc | Rule |
|---|---|
| [research/2026-09-k6-baseline.md](research/2026-09-k6-baseline.md) | Methodology stays, numbers expire |
| [research/2026-09-capacity-notes.md](research/2026-09-capacity-notes.md) | Pool headroom notes, expires |
