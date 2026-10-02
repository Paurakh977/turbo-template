---
title: "Workflow: Add Prisma Model Migration and Pool"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/database-prisma.md"]
sources: ["packages/database/prisma/models/note.prisma", "packages/database/prisma.config.ts", "packages/database/src/client.ts", "pgbouncer/pgbouncer.ini", "apps/migrate/Dockerfile", "docker-compose.yml", "apps/api/src/common/audit-queue.service.ts"]
depends_on: ["invariants/04-database-connections.md", "invariants/05-audit-planes.md", "flows/migration.md", "subsystems/database-prisma.md", "subsystems/database-package.md", "subsystems/docker-environments.md"]
guards: ["packages/database/test/integration/prisma.integration.spec.ts", "apps/api/src/common/audit-outbox.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Add Prisma Model Migration and Pool
> Up: ../00-INDEX.md | Use when: new table or index or pool sizing change. Route: T3.
## Purpose
- Fact: Adds a Prisma fragment plus isolated migrate plus pool math without breaking runtime versus migrate split.
- Interpretation: Fragments are the only edit surface; generated client plus SQL history are never hand-edited.
- Recommendation: Land fragment plus config plus pool math in one PR; never split migrate from pool check.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T3 and confirm Required order before diff.
- [ ] Read `../invariants/04-database-connections.md` pooler versus direct plus pool math.
- [ ] Read `../invariants/05-audit-planes.md` if the model carries audit writes.
- [ ] Read `../flows/migration.md` fragment to migrate image to deploy narrative.
- [ ] Read `../subsystems/database-prisma.md` plus `database-package.md` plus `docker-environments.md`.
- Fact: Pooled migrate reproduces silent routing bug; DIRECT_URL is normative for migrate.
## Steps checklist
- [ ] 1. Add `packages/database/prisma/models/<name>.prisma` fragment copying `note.prisma` cuid plus map plus index.
- [ ] 2. Confirm `packages/database/prisma.config.ts` still snapshots `DIRECT_URL` with fail-fast in prod.
- [ ] 3. Run `db:migrate:dev --name <snake>` locally against direct 5432, review generated SQL delta only.
- [ ] 4. Run `db:generate` so API plus web clients pick up the new model.
- [ ] 5. Recompute pool math `workers x POOL <= MAX_CLIENT` plus `DEFAULT plus RESERVE < MAX_CONN` in compose comments.
- [ ] 6. Update `truncateAllTables` order if seed plus e2e teardown depends on FK order.
- [ ] 7. Check authz plus audit: does the model need fresh-role gate plus outbox enqueue with tx.
- [ ] 8. Keep migrate Dockerfile trim plus boot gate; never add app code to migrate image.
- [ ] 9. Add or extend `prisma.integration` plus `migrate` gate specs for the new model.
## Commands
```sh
pnpm db:migrate:dev --name add_<model>
pnpm db:generate
pnpm db:migrate:deploy
pnpm --filter api test:integration -- -t "prisma"
pnpm --filter api test:integration -- -t "audit-outbox"
```
- Fact: `db:migrate:deploy` is the CI plus prod path; `dev` is local only with direct URL.
- Fact: `DIRECT_URL` must point at 5432 direct; runtime `DATABASE_URL` stays on pooler 6432.
## Files-areas
| Area | Paths |
|---|---|
| Fragment | `packages/database/prisma/models/<name>.prisma` |
| Config | `packages/database/prisma.config.ts` DIRECT_URL snapshot |
| Pool | `packages/database/src/client.ts` Pool plus `pgbouncer/pgbouncer.ini` |
| Migrate | `apps/migrate/Dockerfile` plus `docker-compose.yml` DIRECT_URL |
| Seed | `packages/database/src/seed.ts` plus truncate order |
## Architectural gates
- Fact: Migrate uses `DIRECT_URL` 5432; runtime uses pooler 6432; never cross them.
- Fact: Pool math explicit and independent per client plus server budgets.
- Fact: Drain 20s stays below grace 30s; purge predicate stays DONE-only.
- Fact: No FK from audit to user that would break hard-delete survival.
## Tests
- Fact: Required `prisma.integration` plus migrate gate plus pool gauges plus fail-fast unset DIRECT_URL prod error.
- Fact: Required truncate-order test plus `audit-outbox` tuning pins 250ms slash 50 slash 30s slash 5.
- Fact: Recommended e2e profile boot plus `ports-topology.md` check if ports change.
## Documentation updates
- Fact: Same PR updates `subsystems/database-prisma.md` plus `database-package.md` if pool or seed changed.
- Fact: Same PR updates `reference/env-ownership.md` for DIRECT_URL plus `reference/ports-topology.md` for port shifts.
- Fact: Same PR bumps `updated` plus runs link lint; never paste full SQL into docs.
## Verification
- [ ] `db:generate` clean plus `build` green with no drift between fragment and client.
- [ ] Integration `prisma` plus `migrate-test` plus truncate order green.
- [ ] Pool gauges observed; `MAX_CLIENT` rechecked on `API_WORKERS` change.
- [ ] `git status --short` shows only fragment plus migration delta plus specs plus docs.
## Failure-recovery
- Fact: Bad migration maps to follow-up corrective migration; never edit applied migration directory.
- Fact: Client drift maps to rerun `db:generate` plus rebuild; never hand-edit generated client.
- Fact: Pooler migrate accident maps to revert URL to direct plus re-run deploy on staging first.
- Uncertainty: FINAL-10 Q6 `targetId` always NULL dead versus future; keep hardcoded null, see FINAL-10 Q6.
## Related
- Fact: Up `../00-INDEX.md`; routes T3; enforced by INV-004 plus INV-005.
- Recommendation: Pool tuning pairs with `../subsystems/database-package.md` consumer runbook.
- Recommendation: Audit plane choice in `add-domain-module.md` if model emits events.
