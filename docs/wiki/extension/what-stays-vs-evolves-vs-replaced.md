---
title: "What Stays vs Evolves vs Replaced"
type: extension
status: stable
authority: descriptive
owners: ["subsystems/api-runtime.md"]
sources: ["docker-compose.yml", "scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs", "docs/SCAFFOLD.md", "packages/database/prisma/models/note.prisma"]
depends_on: ["invariants/01-architecture-b.md", "invariants/02-fresh-role.md", "workflows/add-domain-module.md", "decisions/ADR-0003-architecture-b-secret-free-web.md"]
guards: ["scripts/check-web-secrets.mjs", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Extension: What Stays vs Evolves vs Replaced
> Up: ../00-INDEX.md | Consumer entry. Route T1.
> NEVER DELETE: Stays table is architecture not demo. Deleting any row re-opens a Critical or High gap silently. Prune rows only, never seams. Fork PRs deleting these rows without superseding ADR fail review.
## Purpose
- Fact: Template value is architecture plus guards plus workflows, not demo UI. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S1 plus docs/SCAFFOLD.md for clone-and-render fork definition.
- Interpretation: Fork success keeps envelopes plus budgets plus planes intact while demo rows are replaced. Fork failure deletes a guard or compose env.
- Recommendation: Read this file plus notes-canonical-example plus seam-catalog before running workflows/add-domain-module.md. Stop if a prune touches Stays.
## Stays - never delete
- Fact: Rows copy .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S2 verbatim in meaning. Each row names the guard proving it.
| Keep | Why | Guard proving it |
|---|---|---|
| Arch-B secret-free web gateways plus compose web no SECRET | SSR compromise yields no mint or DB bypass | check-web-auth-imports plus check-web-secrets strict |
| roles database auth packages direction roles to auth to api | Fences break highest-signal misuse FINAL-01 S3 | turbo build plus never-imports grep |
| Fresh-role plus ALS-once plus invalidate-success-only plus exactly-once stop | Stale elevation plus split brain plus double row | notes-rbac plus admin-mutations plus stop-impersonation spec |
| Audit dual-plane plus outbox 250ms 50 rows 30s reclaim 5 retries plus DLQ plus DONE-only purge | Ordering and durability SLO for domain writes | audit-outbox spec plus audit-queue spec plus alert max-not-sum |
| DB pooler versus direct plus two-budget math plus isolated migrate image | Pooled migrate stalls deploy advisory-lock failure | prisma integration plus migrate-test plus DIRECT_URL fail-fast |
| Three-layer limits plus no-bypass plus 429 expected plus bare-token plus Lua | Flood shield without blocking legit bursts | rate-limit-thresholds plus e2e ratelimit plus k6 spike |
| OTel dual SDKs plus Alloy plus normalize triple plus instance id plus fail-open | Cardinality and identity breaks blind dashboards | normalize-route spec plus metrics spec plus alert-rules spec |
| Live versus ready plus probe topology plus five profiles plus healthchecks plus env single-source | Self-DDoS deploys plus zeroed budgets | e2e health plus proxy specs plus Joi plus parsers |
| Testing pyramid Jest plus integration plus Playwright plus k6 plus guards | Claims only as strong as gate checking them | reference/test-matrix.md change-to-test rows |
- Interpretation: Demo pruning touching these rows is architecture removal, not pruning. Reviewers treat it as breaking change.
- Recommendation: Keep this table in fork onboarding. Link it from every consumer ADR proposing simplification.
## Evolves - clone Notes seam
- Fact: Business growth copies Notes vertical seam per .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S4 plus 12 S18-S19 Orders runbooks A and B.
| Extend | Seam files in order | Gate |
|---|---|---|
| New Prisma model | packages/database/prisma/models/order.prisma copying note.prisma | migrate DIRECT_URL plus generate plus pool math |
| New API module | apps/api/src/orders/orders.module.ts plus app.module.ts import | turbo build plus no duplicate APP_GUARD |
| New controller service DTO | orders.controller.ts plus orders.service.ts plus dto MaxLength withTotal | service plus DTO plus integration orders-rbac |
| New permissions roles | permissions.ts plus roles index SCOPES plus hierarchy | rbac-matrix plus admin-mutations plus e2e rbac |
| New web route UI | app/dashboard/orders/page.tsx plus actions trio plus OrdersClient | e2e orders CRUD plus plain 403 plus guards green |
| New audit metric | audit-writer order events plus metrics counter plus normalize check | audit-outbox plane review plus normalize-route spec |
| New tests docs | service plus DTO plus integration plus e2e plus visual plus k6 if hot | full pyramid green plus docs chain same PR |
- Interpretation: Route plus dashboard plus audit plus metric are presentational or additive. Enforcement stays in service plus permissions per INV-010.
- Recommendation: Ship behind operator-only flag first with empty user perms, then broaden. Keep withTotal false lean until need proven.
## Replaced - safe to delete
- Fact: Demo content only from .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S3 plus 20 S19. Replace rows and copy, never tables or seams.
| Replace | Keep underlying seam | How |
|---|---|---|
| Notes rows demo titles contents | Notes TABLE plus model plus indexes plus API plus UI plus audit | DELETE rows via seed prune, keep fragment plus migration, add orders after M2 |
| Seed mailboxes demo inboxes | Seed MECHANISM three-pass TRUNCATE plus retry plus storageState | Replace addresses names, keep pass order plus flush retry |
| Theme labs toggles audit-only | Bootstrap with-accounts plus server-audit forwarder plus allowlist shape | Replace with real prefs via forwarder, never add privilege action |
| Dashboard demo cards copy | DashboardShell plus fresh-role poll plus bootstrap coalescing | Replace copy links, keep layout plus 1 HTTP bootstrap plus 60s debounce |
| k6 weights notes 40pct comment | k6 suites helpers thresholds 5xx-only plus 429-expected | Retune weights for orders, keep thresholds, move numbers to research |
- Interpretation: Table drop without follow-up migration breaks applied history. Content delete via seed plus new migration only.
- Recommendation: Prune keeps Stays intact, replaces via workflows/add-domain-module.md, runs guards plus matrix plus e2e, updates catalog plus matrix same PR.
## Prune procedure
- Recommendation: Follow in order and stop on first red gate. Do not batch prune plus feature work.
- Recommendation: Step 1 confirm target is in Replaced table, not Stays. Step 2 execute workflows/add-domain-module.md top to bottom.
- Recommendation: Step 3 run guard web-secrets strict plus guard web-auth-imports plus notes-rbac plus e2e orders before push.
- Recommendation: Step 4 update seam-catalog plus reference/test-matrix plus reference/audit-events plus bump updated same PR plus link lint.
## Guards and verification
- Fact: scripts/check-web-secrets.mjs strict plus scripts/check-web-auth-imports.mjs prove Arch-B survives every prune. See apps/web/src/lib/server/fetch-internal.ts gateway shape.
- Fact: apps/api/test/integration/modules/notes-rbac.integration.spec.ts plus admin-mutations prove fresh-role survives permission edits.
- Fact: apps/api/src/common/audit-queue.service.spec.ts proves outbox tuning survives seed replacement. See packages/database/prisma/models/note.prisma fragment kept.
## Related
- Recommendation: Next read notes-canonical-example for vertical paths, then seam-catalog for per-seam gates, then add-domain-module to execute.
- Recommendation: History in ADR-0003 Architecture B. Constraints in INV-001 plus INV-002 plus INV-005 plus INV-010.
- Uncertainty: Scope-rename repo to scope tooling in scripts/scaffold files not fully traced. See docs/SCAFFOLD.md. Assert nothing beyond scaffold docs.
- Uncertainty: Seed internals summarized not line-audited. Verify seed pass order before pruning. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S3.
- Uncertainty: Web pg plus ioredis leftovers look required but not imported. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q12. Install presence is not runtime use.
## Transplant rule
- Fact: Transplant means copy Notes files then rename scope, never regenerate from blank. See scripts/scaffold/cli.mjs plus copy.mjs for rename mechanics.
- Interpretation: Regeneration drops OTel identity plus migrate casing plus testids that transplant preserves by construction.
- Recommendation: Scaffold by duplicating notes plus audit plus users trio, then add IsIn plus Max plus cap plus assign-guard plus hierarchy day one.
- Uncertainty: Grant-role settingsThemeGrant pattern not exercised by Notes. Consult 05 before use. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S8.
