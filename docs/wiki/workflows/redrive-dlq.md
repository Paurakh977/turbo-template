---
title: "Workflow: Redrive DLQ Single Plus Purge Verify"
type: workflow
status: stable
authority: normative-procedure
owners: ["subsystems/audit.md"]
sources: ["apps/api/src/common/audit-outbox.ts", "apps/api/src/common/audit-queue.service.ts", "packages/database/prisma/models/auditOutbox.prisma", "observability/prometheus/alerts/database.yml", "apps/api/src/common/audit-queue.service.spec.ts"]
depends_on: ["invariants/05-audit-planes.md", "invariants/07-health.md", "invariants/08-observability.md", "flows/audit.md", "flows/observability.md"]
guards: ["apps/api/src/common/audit-queue.service.spec.ts", "apps/api/src/common/audit-outbox.spec.ts", "apps/api/src/common/observability/alert-rules.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Workflow: Redrive DLQ Single Plus Purge Verify
> Up: ../00-INDEX.md | Use when: poison outbox rows need inspect plus single redrive plus purge check. Route: T8.
## Purpose
- Fact: Inspects DLQ plus redrives one id at a time plus verifies purge spares PENDING with admin gate.
- Interpretation: DLQ accumulates by design; single-id redrive bounds blast radius versus bulk replay.
- Recommendation: SELECT 50, count, single-id UPDATE PENDING attempts 0, verify, then purge check, never auto.
## Preconditions
- [ ] Read `../00-INDEX.md` task row T8 and confirm Required order before diff.
- [ ] Read `../invariants/05-audit-planes.md` folded INV-016 DLQ plus purge predicate.
- [ ] Read `../flows/audit.md` deliver plus DLQ plus purge hops plus `../flows/observability.md` backlog surface.
- [ ] Read `../subsystems/audit.md` DLQ plus purge runbook pointer section.
- Fact: Bulk UPDATE without `id ANY` replays poison rows and re-fills DLQ within one backoff cycle.
## Steps checklist
- [ ] 1. Inspect `SELECT id,action,attempts,last_error FROM audit_outbox WHERE status='DLQ' ORDER BY created_at DESC LIMIT 50;`.
- [ ] 2. Count `SELECT count(*) FROM audit_outbox WHERE status='DLQ';` and record before plus after.
- [ ] 3. Pick one id with understood `last_error`; confirm fix deployed before redrive.
- [ ] 4. Redrive single `UPDATE audit_outbox SET status='PENDING',attempts=0,next_attempt_at=NOW(),last_error=NULL,claimed_by=NULL,claimed_at=NULL WHERE status='DLQ' AND id='<id>';`.
- [ ] 5. Verify poller claims plus delivers plus `auditLog` row appears once via idempotency key.
- [ ] 6. Verify purge `purgeDoneBatch` still DONE-only 30d hourly 1000 via PK delete.
- [ ] 7. Confirm admin gate: redrive by operator only, logged with reason, never cron auto.
- [ ] 8. File follow-up for `AuditQueueDLQNonEmpty` alert plus admin count if DLQ recurs.
- [ ] 9. Update `audit-events.md` retention note if event shape caused the poison row.
## Commands
```sh
pnpm --filter api test:integration -- -t "audit-queue"
pnpm --filter api test:integration -- -t "audit-outbox"
pnpm --filter api test:integration -- -t "purgeDoneBatch"
pnpm --filter api test:integration -- -t "alert-rules"
```
- Fact: Canonical SQL lives in `apps/api/src/common/audit-outbox.ts:26-30` plus inline `audit-queue.service.ts:364`.
- Fact: Bulk form uses `WHERE status='DLQ' AND id=ANY($1)` only with reviewed id list, single form uses `WHERE id='<id>'`.
- Fact: Purge test proves PENDING plus CLAIMED plus DLQ never match DONE predicate.
## Files-areas
| Area | Paths |
|---|---|
| SQL | `apps/api/src/common/audit-outbox.ts:26-30` redrive plus `OUTBOX_MAX_ATTEMPTS` |
| Service | `apps/api/src/common/audit-queue.service.ts:255-402` claim plus deliver plus DLQ |
| Model | `packages/database/prisma/models/auditOutbox.prisma` plus partial DONE index |
| Purge | `audit-queue.service.ts:419-449` DONE-only 30d batch 1000 |
| Alert | `observability/prometheus/alerts/database.yml:50-69` BacklogHigh max |
## Architectural gates
- Fact: Single-id first; bulk only with reviewed list and second operator ack.
- Fact: Admin gate required; never auto-redrive via cron or poller config flip.
- Fact: Purge predicate DONE-only; PENDING plus DLQ sparing verified by test.
- Fact: Alert max-not-sum holds; depth gauge never zeroed on enqueue.
## Tests
- Fact: Required `audit-queue.service` DLQ after MAX plus P2025 skip plus retry reschedule.
- Fact: Required `audit-outbox` tuning pins plus `purgeDoneBatch` spares PENDING plus `alert-rules` max.
- Fact: Recommended single-id dry-run on staging with `last_error` redaction check.
## Documentation updates
- Fact: Same PR updates `subsystems/audit.md` DLQ pointer plus `reference/audit-events.md` event row if new poison shape.
- Fact: Same PR notes `ports-topology.md` health appendix only if probe changed during incident.
- Fact: Bump `updated` plus run link lint; never paste PII metadata or full DLQ dump into docs.
## Verification
- [ ] DLQ count before plus after recorded with single id resolved to DONE.
- [ ] `auditLog` shows exactly one row for redriven id via deterministic key dedupe.
- [ ] Purge test green proving DONE-only predicate still holds after change.
- [ ] Alert spec green with max-not-sum intact; no silence added to hide DLQ.
## Failure-recovery
- Fact: Re-DLQ maps to stop redrive, fix root cause, then single-id again; never loop bulk replay.
- Fact: Wrong id maps to no-op because predicate requires `status='DLQ'` plus exact id match.
- Fact: PII in `last_error` maps to pipeline redaction check before sharing SELECT output.
- Uncertainty: FINAL-10 Q9 DLQ no alert dashboard endpoint; manual SELECT until alert lands, see FINAL-10 Q9.
- Uncertainty: FINAL-10 Q10 delivery versus enqueue skew misreads timelines; expose both, see FINAL-10 Q10.
- Uncertainty: FINAL-10 Q7 overlong UA uncapped TEXT bloat; truncate 1KB, see FINAL-10 Q7.
- Uncertainty: FINAL-10 Q6 `targetId` dead column excluded from reads; ADR to populate or drop, see FINAL-10 Q6.
## Related
- Fact: Up `../00-INDEX.md`; routes T8; enforced by INV-005 folded INV-016.
- Recommendation: Triage entry in `debug-prod.md`; plane rules in `../invariants/05-audit-planes.md`.
- Recommendation: Read path stable order `createdAt+id` in `../flows/audit.md` before asserting order.
