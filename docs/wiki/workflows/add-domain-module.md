---
title: "Workflow: Add Domain Module via Notes Seam"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/rbac-rules-users.md"]
sources: ["packages/roles/src/index.ts", "packages/auth/src/shared/permissions.ts", "packages/database/prisma/models/note.prisma", "apps/api/src/notes/notes.module.ts", "apps/api/src/notes/notes.controller.ts", "apps/api/src/notes/notes.service.ts", "apps/api/src/app.module.ts", "apps/web/src/lib/server/internal-api.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/common/audit-queue.service.ts"]
depends_on: ["invariants/02-fresh-role.md", "invariants/03-request-context.md", "invariants/05-audit-planes.md", "invariants/10-ui-enforcement.md", "flows/authenticated-api.md", "flows/audit.md", "subsystems/rbac-rules-users.md", "subsystems/database-prisma.md", "subsystems/web-runtime.md"]
guards: ["scripts/check-web-auth-imports.mjs", "scripts/check-web-secrets.mjs", "apps/api/test/integration/modules/notes-rbac.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Add Domain Module via Notes Seam
> Up: ../00-INDEX.md | Use when: new business entity needing CRUD plus permissions plus UI plus audit plus metric plus tests. Route: T1.
## Purpose
- Fact: This workflow clones the Notes vertical seam end to end without forking architecture.
- Interpretation: Orders is the canonical second domain; copy Notes file order, rename scope, keep plane choice.
- Recommendation: Follow steps top to bottom; never start at web UI before SCOPES plus statement land.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T1 and confirm Required order before diff.
- [ ] Read `../invariants/02-fresh-role.md` plus `../invariants/03-request-context.md` first.
- [ ] Read `../invariants/05-audit-planes.md` plane choice plus `../invariants/10-ui-enforcement.md` presentational rule.
- [ ] Read `../flows/authenticated-api.md` hop table plus `../flows/audit.md` sync versus outbox.
- [ ] Read `../subsystems/rbac-rules-users.md` plus `../subsystems/database-prisma.md` plus `../subsystems/web-runtime.md`.
- [ ] Read `../extension/notes-canonical-example.md` plus seam catalog entry for domain clone.
- Fact: Skipping INV-002 reproduces stale-role elevation; skipping INV-005 loses atomicity.
## Steps checklist
- [ ] 1. Extend `packages/roles/src/index.ts` SCOPES first with `orders:create,list,update,delete` plus hierarchy weight.
- [ ] 2. Extend `packages/auth/src/shared/permissions.ts` statement plus `ADMIN_PLUGIN_ROLES` mapping.
- [ ] 3. Add `packages/database/prisma/models/order.prisma` fragment copying `note.prisma` shape plus index.
- [ ] 4. Run migrate plus generate before writing service code so Prisma client has the model.
- [ ] 5. Add `apps/api/src/orders/` module plus controller plus service plus DTO with `MaxLength` plus `withTotal` lean flag.
- [ ] 6. Import `OrdersModule` in `apps/api/src/app.module.ts` alongside `NotesModule`.
- [ ] 7. Add web `dashboard/orders/page.tsx` plus `actions.ts` helper trio plus `_components/OrdersClient.tsx` with `data-testid`.
- [ ] 8. Wire audit `order_created:orderId` deterministic key plus `ACTION_CONFIG` plus metadata suppression.
- [ ] 9. Add metric `orders_operations_total` plus `normalizeRoute` check under 20 routes.
- [ ] 10. Add service spec plus DTO spec plus integration `orders-rbac` plus e2e `orders` plus k6 only if hot path.
## Commands
```sh
pnpm db:migrate:dev --name add_order
pnpm db:generate
pnpm --filter api test:integration -- -t "orders-rbac"
pnpm --filter web test:e2e -- -g "orders"
pnpm guard:web-secrets -- --strict
pnpm guard:web-auth-imports
pnpm k6:smoke
```
- Fact: `db:migrate:dev` uses `DIRECT_URL` 5432 bypass; never migrate through pooler 6432.
- Fact: `test:integration` maps to `turbo run test:integration --filter=api`; `-t` filters by spec name.
## Files-areas
| Area | Paths |
|---|---|
| Roles | `packages/roles/src/index.ts` SCOPES plus hierarchy |
| Permissions | `packages/auth/src/shared/permissions.ts` statement plus roles |
| Model | `packages/database/prisma/models/order.prisma` fragment |
| API | `apps/api/src/orders/*` plus `app.module.ts` import |
| Web | `apps/web/src/app/dashboard/orders/*` plus actions plus client |
| Audit | `apps/api/src/common/audit-writer.ts` plus queue plus metadata |
## Architectural gates
- Fact: No `session.user.role` branch in api; verdicts call `getFreshRoleRaw` PG ALS-memoized per request.
- Fact: Web stays secret-free; no `DATABASE_URL` or auth-root runtime import in web bundle.
- Fact: Domain writes use outbox same-tx; privilege writes never go through queue.
- Fact: `normalizeRoute` triple-sync holds; no `SkipThrottle` on health.
## Tests
- Fact: Required `notes-rbac` pattern cloned to `orders-rbac` covering 401 plus 403 plus own plus `withTotal`.
- Fact: Required `admin-mutations` plus `audit-outbox` plane review plus e2e writer CRUD plus plain-user 403.
- Fact: Recommended `audit-logging` integration plus `test-matrix.md` row check for new permission.
## Documentation updates
- Fact: Same PR updates `subsystems/rbac-rules-users.md` plus `database-prisma` plus `web-runtime` if touched.
- Fact: Same PR adds `reference/audit-events.md` row for `order_created` plus `reference/test-matrix.md` row.
- Fact: Same PR updates `extension/seam-catalog.md` plus `00-INDEX.md` router only if new seam added.
- Fact: Bump `updated` on every touched doc plus run link lint.
## Verification
- [ ] Guards `check-web-auth-imports` plus `check-web-secrets --strict` both green.
- [ ] Integration `orders-rbac` 401 slash 403 slash ownership slash `withTotal` green.
- [ ] E2E writer CRUD plus plain-user 403 plus hint green on e2e profile.
- [ ] Audit outbox row for `order_created` present with deterministic idempotency key.
- [ ] `git status --short` shows only intended module plus spec plus docs paths.
## Failure-recovery
- Fact: New migration misnamed maps to follow-up migration; never edit applied migration SQL.
- Fact: Outbox rows drain naturally via poller; DLQ single-id redrive per `redrive-dlq.md`, never auto.
- Fact: Web secret hit maps to revert import to gateway `internal-api.ts` plus rerun guard.
- Uncertainty: FINAL-10 Q2 `bodyParser:false` 2MB vendor mount may not cover domain routes; see FINAL-10 Q2.
- Uncertainty: FINAL-10 Q3 interceptor order unpinned; both non-mutating today, see FINAL-10 Q3.
- Uncertainty: FINAL-10 Q1 e2e `/` versus `/api` prefix drift; run stub suite before trusting e2e green, see FINAL-10 Q1.
- Uncertainty: FINAL-10 Q6 `targetId` always NULL dead versus future; hardcode null, see FINAL-10 Q6.
## Related
- Fact: Up `../00-INDEX.md`; routes T1; enforced by INV-002 plus INV-003 plus INV-005 plus INV-010.
- Recommendation: Next read `../extension/notes-canonical-example.md` for full vertical paths.
- Recommendation: DLQ ops in `redrive-dlq.md`; prod triage in `debug-prod.md`.
