---
title: "ADR-0002 PG Outbox Not Broker"
type: adr
status: accepted
authority: normative-history
owners: ["subsystems/audit.md"]
sources: ["apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "packages/database/prisma/models/auditOutbox.prisma"]
depends_on: ["invariants/05-audit-planes.md", "flows/audit.md", "subsystems/audit.md"]
guards: ["apps/api/src/common/audit-queue.service.spec.ts", "apps/api/src/common/audit-outbox.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# ADR-0002 PG Outbox Not Broker
> Up: ../00-INDEX.md | Status: accepted | Routes T1 T8.
## Status
- Fact: Accepted. Domain audit uses PG audit_outbox same-tx plus poller. See apps/api/src/common/audit-outbox.ts 44-66 for tuning 250 plus 50 plus 30s plus 5.
## Context / Problem
- Fact: Domain writes need atomic business plus audit commit without second infra. Volume fits poll bound 250ms 50 rows with SKIP LOCKED claim and backoff 5 times to DLQ.
- Interpretation: Ordering best-effort acceptable, durability plus atomicity are not negotiable for forensics.
- Fact: Privilege writes use sync post-commit plane, domain writes use outbox durable plane. See apps/api/src/common/audit-writer.ts rule plus flows/audit.md.
## Decision
- Fact: Same-tx INSERT into audit_outbox plus 250ms poll plus 50 claim plus atomic INSERT DONE plus retry 1s 5s 30s 120s plus DONE-only purge 30d. Drain 20s stays under grace 30s.
- Recommendation: Privilege events stay on sync post-commit plane, never queue role ban revoke paths. New domain events MUST choose outbox with deterministic idempotency.
- Fact: Poller uses SKIP LOCKED plus CAS plus POLLER_ID plus timers unrefd as singleton. See apps/api/src/common/audit-queue.service.ts 84-142.
## Rejected alternatives
- Redis Streams or BullMQ: needs second durable infra plus at-least-once without tx atomicity. Volume does not justify ops cost. Rejected for atomicity loss.
- RabbitMQ or Kafka: overkill for low-rate domain rows, fan-out routing unused, ops cost exceeds benefit at current scale. Rejected for overkill.
- PG LISTEN plus NOTIFY: lossy on disconnect, no durable backlog, poll plus index meets 5s gateway bound deterministically. Rejected for lossiness.
## Consequences
- Fact: Positive single infra, tx atomicity, PgBouncer-safe batch tx. Negative poll floor 250ms, no global FIFO, DLQ needs ops runbook via redrive-dlq workflow.
- Interpretation: Backlog plus DLQ visibility stays ops-owned via max-not-sum alert plus admin count, not automatic.
## Revisit-when
- Recommendation: Revisit when sustained volume starves batch 50 or cross-service fan-out needs broker routing. Then new ADR superseding this one, never edit history.
## Related invariants and implementation
- Recommendation: Constrained by INV-005 audit planes. Traversed by flows/audit.md. Owned by subsystems/audit.md. Verified by audit-queue plus audit-outbox specs.
- Fact: Refs apps/api/src/common/audit-queue.service.ts plus audit-outbox.ts plus audit-writer.ts plus subsystems/audit.md plus workflows/redrive-dlq.md.
- Uncertainty: FINAL-10 Q6 targetId always NULL dead versus future. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q6. Never assert target semantics.
- Uncertainty: FINAL-10 Q7 overlong UA uncapped TEXT plus Q8 maps TTL sweep plus Q9 DLQ invisible plus Q10 delivery skew. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q7 Q8 Q9 Q10.
## Verification
- Fact: Verify with audit-outbox plus audit-queue plus purgeDoneBatch specs plus DLQ SELECT count plus alert-rules max-not-sum green before merge.
