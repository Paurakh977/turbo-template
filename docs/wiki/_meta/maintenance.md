---
title: "Wiki Maintenance (Human Process)"
type: meta
status: stable
authority: meta
owners: []
sources: [".agent/wiki-discovery/FINAL-09-WIKI-MAINTENANCE-MODEL.md", ".agent/wiki-discovery/FINAL-06-DOCUMENTATION-AUTHORITY.md", ".agent/wiki-discovery/PHASE2-07-MAINTENANCE-MODEL.md", ".agent/wiki-discovery/PHASE2-03-DOCUMENT-SCHEMAS.md"]
depends_on: ["00-INDEX.md"]
guards: ["docs/wiki/_meta/link-lint.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Wiki Maintenance (Human Process)
> Up: ../00-INDEX.md | Audience: humans editing docs | Machine companion: `registry.json` plus `link-lint.mjs` | Code wins on conflict
## Purpose
- Fact: This file condenses `.agent/wiki-discovery/FINAL-09-WIKI-MAINTENANCE-MODEL.md` (38 lines) plus `PHASE2-07-MAINTENANCE-MODEL.md` propagation chain for human editors.
- Fact: Folders help humans browse; `depends_on` graph lets CI verify freshness and lets agents route per `PHASE2-13-IMPLEMENTATION-BLUEPRINT.md` S2.
- Recommendation: Never read whole wiki to edit one file; follow trigger table row plus protocol below same PR.
## Propagation diagram
```text
1. Code/config/schema/policy (FINAL-06 ranks 1-5, winning source)
2. Invariant(s) rank 6 (guard plus test same PR)
3. Flow(s) hop-table row updated
4. Subsystem(s) 14-section schema
5. Workflow(s) commands plus gates
6. Reference table(s) row regenerated
7. INDEX plus GLOSSARY plus registry
8. ADR rank 7 ONLY if rationale changes (new file, never edit history)
```
- Fact: Each touched page bumps `updated: YYYY-MM-DD` and extends `depends_on` if a new edge appears; `link-lint.mjs` must pass.
## Trigger table (same PR)
| Code change | Wiki updates in chain order |
|---|---|
| New domain module | workflows/add-domain-module.md checklist plus subsystems touched plus reference/audit-events.md plus test-matrix.md plus extension/seam-catalog.md plus 00-INDEX.md if new seam |
| New model/migration | subsystems/database-prisma.md plus flows/migration.md hop row plus invariants/04-database-connections.md only if pool rules change plus workflows/add-model.md |
| New permission/role | invariants/02-fresh-role.md plus subsystems/rbac-rules-users.md plus reference/audit-events.md role_changed row plus workflows/add-permission-role.md |
| New env var | reference/env-ownership.md row plus invariants/09-env.md if baked-vs-runtime changes plus subsystems/env-config.md plus workflows/change-docker-env.md |
| New rate limit/scope | invariants/06-rate-limits.md plus reference/rate-limit-matrix.md plus redis-keys.md plus subsystems/redis.md plus nginx-edge.md plus k6 thresholds review |
| New audit event | Plane choice sync-vs-outbox plus reference/audit-events.md row plus invariants/05-audit-planes.md if tuning 250/50/30s/5 changes plus subsystems/audit.md |
| New route/metric | invariants/08-observability.md triple plus flows/observability.md plus subsystems/observability-app.md plus observability-infra.md plus alerts review |
| New service/port | reference/ports-topology.md row plus compose profiles plus health live-only plus invariants/07-health.md if probe changes plus subsystems/docker-environments.md |
| Behavior rationale change | New ADR file with Supersedes link, never edit history in place, plus linked invariant section plus affected flows |
- Fact: Source rows mirror `FINAL-09` S1; exact filenames from `PHASE2-01` tree; verification companion is `reference/test-matrix.md`.
## ADR vs invariant vs index
- Fact: ADR required for cluster sizing, outbox-vs-broker, Arch-B exceptions, fresh-role exceptions, health gating, fail-open, CJS/ESM, migrate image, bypass proposals, RUM baking.
- Fact: Invariant update only with code plus guard/test same PR; example new `IsIn` allowlist plus spec; never relax invariant in workflow.
- Fact: Index/router update only for new subsystem/seam/workflow; headlines carry no code by design.
- Recommendation: Rationale edits masquerading as rule edits are the top rot vector; classify bug vs stale-spec vs stale-wiki vs genuine-open per `PHASE2-07` S1.
## Agent protocol
1. Cite winning source (FINAL-06) plus exact paths with symbols.
2. Update invariant to flow to workflow to reference to index chain via `depends_on`.
3. Bump `updated` plus run `node docs/wiki/_meta/link-lint.mjs` plus relevant guards/specs.
4. Research gets `expires` 6mo; never promotes to invariant without ADR.
- Fact: Consistency rule is code wins; wiki PR must resolve toward code or change code explicitly, never silent divergence.
## Stale detection
- Fact: Link lint checks `depends_on` existence plus frontmatter enums plus `updated` format; research expiry cron opens refresh/archive PR with `superseded-by`.
- Fact: Guards as CI are `check-web-auth-imports` plus `check-web-secrets` plus `normalize-route.spec` plus `alert-rules.spec` max-not-sum plus `stop-impersonation-audit.spec` exactly-once.
- Recommendation: Proposed env-contract parity plus `stop_grace(30)>drain(20)` assert plus dashboard slug check plus DLQ-count alert (FINAL-10 Q9 missing today, add `AuditQueueDLQNonEmpty`).
- Uncertainty: FINAL-10 Q1-Q13 stay as build checks; each touched doc carries Uncertainty callout with FINAL-10 path, never guesses as fact. See `.agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md`.
## Related
- Fact: Machine list in `registry.json`; lint in `link-lint.mjs`; router in `../00-INDEX.md`; schemas in `.agent/wiki-discovery/PHASE2-03-DOCUMENT-SCHEMAS.md`.
- Recommendation: Process change only triggers edit here; never feature-load this file per PHASE2-13 S13.
