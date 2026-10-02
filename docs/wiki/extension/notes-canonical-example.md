---
title: "Notes Canonical Example"
type: extension
status: stable
authority: descriptive
owners: ["subsystems/database-prisma.md"]
sources: ["packages/database/prisma/models/note.prisma", "apps/api/src/notes/notes.module.ts", "apps/api/src/notes/notes.controller.ts", "apps/api/src/notes/notes.service.ts", "packages/auth/src/shared/permissions.ts", "packages/roles/src/index.ts", "apps/web/src/lib/server/internal-api.ts", "apps/api/src/common/audit-writer.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/05-audit-planes.md", "invariants/10-ui-enforcement.md", "flows/authenticated-api.md", "flows/audit.md", "workflows/add-domain-module.md", "decisions/ADR-0002-pg-outbox-not-broker.md", "decisions/ADR-0004-fresh-role-not-snapshot.md"]
guards: ["apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "scripts/check-web-auth-imports.mjs"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Extension: Notes Canonical Example
> Up: ../00-INDEX.md | Full vertical slice to transplant for Orders. Route T1. Copy files in order, rename scope, keep gates.
## Why Notes is canonical
- Fact: Notes is the smallest full vertical API plus web plus tests plus audit plus metric in this repo. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S4 plus 12 S18-S19 runbooks.
- Fact: Paths below are exact transplant sources. Each step lists file to copy plus gate that must stay green.
- Interpretation: Orders repeats this seam file for file. Skipping SCOPES first or fragment-then-migrate breaks later gates.
- Recommendation: Execute steps 1 to 9 in order. Stop on first red gate. Do not start web before service plus permissions land.
## Step 1 Model - Prisma fragment
- Fact: Copy packages/database/prisma/models/note.prisma to order.prisma with cuid id plus title 200 plus content status plus authorId FK cascade plus author plus createdAt Desc index plus map.
- Fact: Run pnpm db:migrate:dev with DIRECT_URL postgres 5432 never pooler 6432, then pnpm db:generate. See packages/database/prisma.config.ts precedence plus flows/migration.md.
- Recommendation: Review covering index before migrate. Never edit applied migration SQL, follow-up migration only.
- Gate: prisma integration spec plus migrate-test green plus client has new model.
## Step 2 Module - Nest wiring
- Fact: Copy apps/api/src/notes/notes.module.ts to orders.module.ts with controllers OrdersController plus providers OrdersService plus AuthorizationService, then import in apps/api/src/app.module.ts alongside NotesModule.
- Fact: No UseGuards duplicate because global APP_GUARD already enforces Throttler plus Auth. See apps/api/src/app.module.ts 173-199 plus subsystems/api-runtime.md.
- Gate: turbo build green for api plus web with no guard duplication lint error.
## Step 3 Validation - DTO and query
- Fact: Copy apps/api/src/notes/dto plus ListNotesQuery to ListOrdersQuery with MaxLength title 200 plus withTotal lean flag false default. See apps/api/src/notes/notes.controller.ts list shape.
- Fact: Controller exposes Controller orders GET list withTotal plus POST 201 create plus PATCH id plus DELETE 204 with extractClientMeta IP UA. ValidationPipe rejects overlong plus unknown.
- Gate: dto spec plus 400 validation path in integration orders-rbac green.
## Step 4 Permissions - statement plus SCOPES
- Fact: Extend packages/auth/src/shared/permissions.ts statement orders create read update delete list plus ADMIN_PLUGIN_ROLES mapping, plus packages/roles/src/index.ts SERVER_ACTION_SCOPES orders create update delete.
- Fact: Extend apps/api/src/users/users.controller.ts APP_RESOURCES with orders plus MyBootstrap permissions type plus web MyBootstrap. See subsystems/rbac-rules-users.md.
- Recommendation: Add IsIn plus Max plus assign-guard plus hierarchy day one per 14 S20. Ship operator-only first with empty user perms.
- Gate: rbac-matrix plus admin-mutations green plus grep shows SCOPES exact strings.
## Step 5 Authz - service enforcement
- Fact: Copy apps/api/src/notes/notes.service.ts to orders.service.ts with listForSession create update remove using assertPermission effectiveRole orders verb plus ownership author-only unless admin plus viewerRole return.
- Fact: Single getFreshRoleRaw per request ALS memo, never session.user.role branch. See apps/api/src/common/authorization.service.ts 82-92 plus invariants/02-fresh-role.md.
- Gate: service spec operator perm versus ownership plus effective-id impersonation copied from notes.service.spec.ts 170 and 221 green.
## Step 6 Audit - plane plus idempotency
- Fact: API uses apps/api/src/common/audit-writer.ts enqueueSessionAudit same-tx pattern from notes.service.ts 191-209 with clientMeta IP UA plus idempotency order_created orderId deterministic.
- Fact: Web adds ACTION_CONFIG entries plus formatMetadata suppression orderId like noteId. Choose outbox durable for domain volume not sync privilege-only per audit-writer rule.
- Gate: audit-outbox spec plane review green plus integration asserts outbox row with deterministic key.
## Step 7 Metrics - counter plus normalize
- Fact: Add orders_operations_total counter in apps/api/src/common/observability/metrics.service.ts reusing getMeter global idempotent, never new registry. See subsystems/observability-app.md.
- Fact: Extend normalizeRouteForMetrics static segment under 20 chars. Dynamic order id maps to placeholder so cardinality stays bounded.
- Gate: normalize-route spec plus metrics spec green with no new unbounded label.
## Step 8 Web - page plus actions plus client
- Fact: Copy apps/web/src/app/dashboard/notes/page.tsx to orders page with force-dynamic plus resolvePageData bootstrap cached 0 HTTP plus callInternalApi api orders withTotal false typed orders plus viewerRole.
- Fact: Copy actions.ts helper trio getBootstrapAndRateLimit plus redirectIfUnauthenticated plus rateLimitError with scopes orders create 60s10 update 60s20 delete 60s10 plus trim max plus revalidatePath dashboard orders.
- Fact: Copy NotesClient to OrdersClient with ViewHint scope plus author admin edit gate plus confirmed delete plus data-testid order prefix. See apps/web/src/lib/server/internal-api.ts plus bootstrap.ts.
- Gate: internal-api spec plus guards web-auth-imports plus web-secrets green plus e2e orders writer CRUD plus plain 403.
## Step 9 Tests plus docs chain
- Fact: Copy dto spec plus service spec plus integration orders-rbac 401 unauth 403 plain create ownership admin all-scope 400 validation withTotal plus e2e orders spec writer CRUD plus plain 403 via ApiClient plus scope hint plus visual snapshots.
- Fact: Add k6 scenario only if hot path with thresholds 5xx-only plus 429-expected. Numbers go to research dated file, never invariants.
- Fact: Same PR updates reference/audit-events plus reference/test-matrix plus extension/seam-catalog plus INDEX consumer row plus updated bumps plus link lint. Mark new docs template false, modified template extended.
- Gate: Full pyramid green plus link-lint green plus guards green.
## Transplant checklist
| Order | Copy from | Rename to | Gate |
|---|---|---|---|
| 1 | note.prisma fragment | order.prisma fragment | migrate plus generate |
| 2 | notes.module controller service dto | orders.module controller service dto | build plus dto spec |
| 3 | permissions statement plus SCOPES | orders verbs plus scopes | rbac-matrix |
| 4 | notes page actions NotesClient | orders page actions OrdersClient | e2e plus guards |
| 5 | audit-writer note events plus metric | order events plus orders counter | outbox plus normalize |
## Related
- Recommendation: Execute via workflows/add-domain-module.md top to bottom. Catalog every new seam in seam-catalog.md same PR.
- Recommendation: Constraints in INV-002 plus INV-003 plus INV-005 plus INV-010. Planes in flows/audit.md. History in ADR-0002 plus ADR-0004.
- Uncertainty: Orders indexing authorId plus createdAt should mirror notes whatever notes uses. Verify schema before cloning. See .agent/wiki-discovery/PHASE2-12-TEMPLATE-FORK-MODEL.md S8.
- Uncertainty: MyBootstrap permissions shape adding orders key needs web plus API deploy order check. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md general plus 12 S20.
- Uncertainty: FINAL-10 Q6 targetId always NULL. Hardcode null for order events, never assert forensic join. See FINAL-10 Q6.
- Uncertainty: FINAL-10 Q10 delivery versus enqueue skew under backlog. Expose both timestamps in admin UI, never assert order. See FINAL-10 Q10.
## Naive risks
- Interpretation: Starting at web UI before SCOPES lands produces scope-string mismatch that only surfaces in e2e 403 hint assertions.
- Interpretation: Putting domain writes on sync plane loses durability on crash. Putting privilege writes on queue adds latency and ordering risk.
- Recommendation: Keep withTotal false lean, add hierarchy plus invalidation day one, keep OTel getMeter identity when copying metrics wiring.
