---
title: "Seam Catalog"
type: extension
status: stable
authority: descriptive
owners: ["subsystems/database-prisma.md"]
sources: ["docs/SCAFFOLD.md", "scripts/scaffold/cli.mjs", "scripts/scaffold/copy.mjs", "packages/database/prisma/models/note.prisma", "apps/api/src/notes/notes.service.ts", "packages/auth/src/shared/permissions.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/05-audit-planes.md", "invariants/08-observability.md", "workflows/add-domain-module.md", "extension/notes-canonical-example.md"]
guards: ["scripts/scaffold/cli.mjs", "apps/api/test/integration/modules/notes-rbac.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Extension: Seam Catalog
> Up: ../00-INDEX.md | Every seam plus transplant rule plus gates. Route T1 and T4. Copy in listed order, never regenerate blank.
## Transplant not regenerate
- Fact: Transplant means duplicate Notes plus audit plus users trio then rename scope. See docs/SCAFFOLD.md plus scripts/scaffold/copy.mjs plus transform.mjs for rename mechanics.
- Fact: Regeneration from blank drops OTel getMeter identity plus migrate file casing plus k6 casing plus data-testid stability that transplant preserves.
- Interpretation: Scaffold CLI copies structure and renames scope tokens. Hand-regenerated modules miss hierarchy plus invalidation plus IsIn that the trio carries day one.
- Recommendation: Use scaffold CLI or manual copy-rename, never blank-file authoring for domain modules. Preserve getMeter string literal exactly.
## OTel preserve rule
- Fact: Reuse getMeter global idempotent string literal from apps/api/src/common/observability area. Never create new registry or new meter name per domain.
- Interpretation: Divergent meters split series and blind dashboards 01-06. Instance id per worker already distinguishes series, no per-domain meter needed.
- Recommendation: Copy metrics wiring verbatim, only add counter name orders_operations_total plus normalize route entry.
## Migrate and k6 casing
- Fact: Migrate fragments live in packages/database/prisma/models with lowercase singular file names like note.prisma. Migrations use timestamped SQL, never edited after apply.
- Fact: k6 suites keep lowercase hyphen casing plus thresholds 5xx-only plus 429-expected. Weights retune per domain, methodology never changes.
- Recommendation: Match note.prisma casing exactly for order.prisma. Match k6 scenario naming for orders scenario.
## Catalog
- Fact: Each row is one transplantable seam. Files column is copy order. Gate column must stay green before next seam starts.
| Seam | Files in order | Gate | Notes |
|---|---|---|---|
| Prisma model fragment | packages/database/prisma/models/note.prisma to order.prisma | migrate DIRECT_URL plus generate | cuid id plus author FK cascade plus Desc index |
| Migrate deploy | prisma.config DIRECT_URL plus apps/migrate/Dockerfile plus compose DIRECT_URL | migrate-test plus boot gate | never pooler 6432 for deploy |
| API module wiring | apps/api/src/notes/notes.module.ts to orders.module.ts plus app.module import | turbo build | no duplicate APP_GUARD comment 32-34 |
| Controller DTO | notes.controller.ts plus dto to orders equivalents | dto spec plus 400 path | withTotal false lean default |
| Permissions statement | packages/auth/src/shared/permissions.ts orders verbs plus ADMIN mapping | rbac-matrix | IsIn plus Max day one |
| Role SCOPES | packages/roles/src/index.ts SERVER_ACTION_SCOPES plus hierarchy | admin-mutations | assign-guard plus hierarchy weight |
| Service authz | notes.service.ts to orders.service.ts effectiveRole plus ownership | service spec plus integration | single fresh-role ALS memo |
| Session context | request-context plus session.utils plus interceptor once | request-context spec | capture-at-emit for background |
| Audit event | audit-writer enqueue same-tx plus ACTION_CONFIG plus suppression | audit-outbox spec | deterministic order_created orderId |
| Metric counter | metrics.service counter plus normalizeRoute entry | normalize-route spec | under 20 static routes |
| Web page | dashboard notes page to orders page force-dynamic resolvePageData | internal-api spec | bootstrap cached 0 HTTP |
| Web actions | actions.ts helper trio scopes create 60s10 update 60s20 delete 60s10 | server-action spec | trim max plus revalidatePath |
| Web client | NotesClient to OrdersClient ViewHint plus data-testid | e2e orders plus guards | author admin gate |
| Tests pyramid | dto plus service plus integration orders-rbac plus e2e plus visual | full pyramid green | 401 403 own withTotal |
| Docs chain | audit-events plus test-matrix plus INDEX consumer row | link-lint | template false versus extended |
## Per-seam invariants
- Fact: Model plus migrate seams obey INV-004 pooler versus direct. Service plus permissions obey INV-002 fresh-role. Audit seam obeys INV-005 plane choice. Web seams obey INV-001 secret-free plus INV-010 presentational.
- Recommendation: Check invariant header before each seam. SCOPES first, fragment then migrate, plane before event, hierarchy plus invalidation day one.
## Add-seam procedure
- Recommendation: Step 1 read what-stays plus notes-example plus this catalog. Step 2 execute workflows/add-domain-module top to bottom, stop on red.
- Recommendation: Step 3 update docs chain subsystems plus reference/audit-events plus test-matrix plus INDEX plus updated bumps plus link lint same PR per FINAL-09 S3.
- Recommendation: Step 4 mark every touched doc template false for pure-app like orders subsystem, template extended for modified template like audit-events, template true untouched.
## Guards
- Fact: scripts/scaffold/cli.mjs validate.mjs plus graph.mjs check rename plus scope collision before code lands.
- Fact: apps/api/test/integration/modules/notes-rbac.integration.spec.ts pattern cloned to orders-rbac proves ownership plus scope enforcement.
## Related
- Recommendation: Next execute workflows/add-domain-module.md. Full paths in notes-canonical-example.md. Policy in what-stays-vs-evolves-vs-replaced.md.
- Uncertainty: Grant-role settingsThemeGrant pattern not exercised by Notes. Consult 05 before use. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S8.
- Uncertainty: Orders volume versus notes for purge 30d hourly 1000 plus poll 250 50 adequacy unknown. Start same tuning, add ADR-1001 revisit trigger.
- Uncertainty: FINAL-10 Q6 targetId dead versus future. Do not add target column to new seams until ADR resolves populate or drop.
## Consumer ADRs
- Fact: Template reserves ADR-0001 to 0999. Consumers number from ADR-1000 to avoid collision. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S5.
- Recommendation: Example ADR-1001-orders-outbox-reuse states context volume fits poll, decision reuse PG outbox same-tx, rejected BullMQ Kafka LISTEN, revisit batch 50 starved.
- Recommendation: Consumer ADR proposing simplification must cite rejecting template ADR first, for example cache-roles must read ADR-0004.
- Interpretation: Code comments stay normative until promoted. Propose comment normative then ADR wins for why, code wins for what, link ADR same PR.
## Index update rule
- Fact: 00-INDEX.md is the only global page. Consumers append consumer task rows, never edit template rows in place.
- Recommendation: Add Orders refunds row pointing at T1 bundle plus new workflow if needed. Header banner marks Template keep guard versus App fork-owned.
- Uncertainty: Registry codeowner sync plus expiry cron deferred to meta build. Manual banner until lint enforces. See FINAL-10 general.
## Anti-patterns pointer
- Fact: Each anti-pattern passes lint yet breaks fork, from 14 S17 plus 20 gaps: pooled migrate, session role, frontend-only, bypass headers, SkipThrottle health, Number fallback, ALS in workers.
- Recommendation: Link 14 S17 checklist as PR gate. Require second review if touched area overlaps Stays rows.
- Uncertainty: OTel Alloy Tempo Pyroscope compat plus retention plus arm64 unverified. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q11. Never guess versions.
## Fork lifecycle (new domain)
- Fact: Keep template invariants plus flows plus ADRs unchanged; extend subsystems plus workflows plus reference tables with app rows; add app ADRs as ADR-1000+; append consumer task rows to 00-INDEX without editing template rows; mark replaced demo docs (notes rows, seed mailboxes) as superseded, never silently overwrite.
## Verification
- Fact: Transplant preserves dashboard data-testid stability plus k6 threshold shape plus pooler runtime path by construction.
- Recommendation: Verify with guards plus specs in reference/test-matrix.md before merge. Never read whole wiki, follow one task row.
- Fact: Up link plus one H1 plus pipe tables keep this file grep-friendly and link-lint clean.
