---
title: "Two Audit Planes Sync versus Outbox"
type: invariant
status: stable
authority: normative-constraints
owners: ["subsystems/audit.md"]
sources: ["packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/common/audit-metadata.ts"]
depends_on: ["decisions/ADR-0002-pg-outbox-not-broker.md", "flows/audit.md"]
guards: ["apps/api/src/common/audit-outbox.spec.ts", "apps/api/src/common/audit-queue.service.spec.ts", "apps/api/test/integration/modules/audit-logging.integration.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# INV-005 Two Audit Planes Sync versus Outbox
> Up: ../00-INDEX.md
**ID:** INV-005
## Invariant
- Fact: Auth privilege writes MUST use sync post-commit best-effort; domain writes MUST use durable outbox INSERT in same transaction with poller deliver.
## Why
- Fact: Wrong plane loses ordering or durability; domain via sync adds RTT, privilege via queue loses order and DLQ alerting (FINAL-07 Medium-01).
## Code
- Fact: `packages/auth/src/server/audit-plugin.ts:60-75` `writeAudit` catch-log never throws, before never writes success; role plus ban only in plugin after never in `database-hooks.ts:119-123`.
- Fact: `apps/api/src/common/audit-queue.service.ts:84-142` `enqueueSessionAudit` same-tx when tx passed; `apps/api/src/common/audit-outbox.ts:44-66` tuning POLL 250ms plus BATCH 50 plus CLAIM 30s plus MAX 5 plus DRAIN 20s below grace 30s.
- Fact: `apps/api/src/common/audit-writer.ts` `buildAuditRowData` captures at emit; Global singleton `audit-queue.module.ts:1-16` timers unrefd never overlap.
### Folded INV-012 unforgeable attribution plus allowlist
- Fact: `apps/api/src/common/audit-metadata.ts:16-25` strips server keys before merge; `apps/api/src/audit/audit.controller.ts:34-38` allowlist only 3 UX actions with 4096 cap; P2002 silent success.
- Fact: Token redaction plus IP fail-closed plus no-FK survival plus `targetId` always NULL dead excluded from reads.
### Folded INV-016 DLQ-accumulates plus purge-predicate
- Fact: DLQ accumulates by design via CAS plus terminal fail record; redrive canonical SELECT plus single-id UPDATE only; purge DONE-only 30d bounded 1000 via PK delete.
- Fact: Alert uses max-not-sum `AuditQueueBacklogHigh`; depth gauge owned by refresh only never zeroed on enqueue.
## Consequences
- Fact: Notes stay atomic with audit row; privilege rows stay ordered and visible even when queue lags or DLQ fills.
## Naive failure mode
- Interpretation: Enqueueing `role_changed` or awaiting `note_created` inline without tx breaks atomicity; branching on queue success misuses write-only contract.
- Interpretation: Raising DRAIN above grace or purging without DONE predicate deletes PENDING plus DLQ evidence.
## Guards-tests
- Fact: Run `audit-outbox` plus `audit-queue.service` plus `audit-logging` plus controller allowlist specs; verify drain below grace and DLQ redrive SQL shape.
- Fact: For invalidate-success-only see [02-fresh-role.md](02-fresh-role.md) INV-013 pointer only; this file owns only planes plus attribution plus DLQ.
## Related ADRs
- Recommendation: See [ADR-0002 PG Outbox](../decisions/ADR-0002-pg-outbox-not-broker.md) for broker versus PG poll rationale.
## Related flows-subsystems
- Recommendation: Enforced in [audit](../flows/audit.md) plus authenticated-api; owned by [audit](../subsystems/audit.md).
- Uncertainty: FINAL-10 Q6 `targetId` populate versus drop unconfirmed dead versus future; see FINAL-10 Q6.
- Uncertainty: FINAL-10 Q7 overlong UA truncation uncapped TEXT risk; see FINAL-10 Q7.
- Uncertainty: FINAL-10 Q8 in-process maps TTL sweep unverified; see FINAL-10 Q8.
- Uncertainty: FINAL-10 Q9 DLQ has no alert dashboard endpoint; poison rows sit invisible, see FINAL-10 Q9.
