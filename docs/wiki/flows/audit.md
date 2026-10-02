---
title: "Flow: Audit Sync versus Outbox"
type: flow
status: stable
authority: descriptive
owners: ["subsystems/audit.md"]
sources: ["packages/auth/src/server/audit-plugin.ts", "packages/auth/src/server/database-hooks.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "apps/web/src/lib/server/server-audit.ts"]
depends_on: ["invariants/05-audit-planes.md"]
guards: ["apps/api/test/integration/modules/audit-logging.integration.spec.ts", "apps/api/test/integration/modules/admin-mutations.integration.spec.ts", "apps/web/e2e/tests/audit/audit.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Flow: Audit Sync versus Outbox
> Up: ../00-INDEX.md | Depends on: INV-005
## Purpose
- Fact: Contrasts synchronous auth plane for privilege changes with same-transaction outbox plane for domain writes.
- Interpretation: Sync preserves order for role/ban; outbox preserves durability without hot-path RTT for volume.
- Recommendation: Choose plane by privilege impact; pass tx for note plus outbox; never branch on queue result.
## Diagram
```text
auth action -> auditLogPlugin(before stash/after isSuccess+write+invalidate)
domain action -> notes.service(tx: note INSERT + outbox INSERT same-tx)
  -> audit-queue poller 250ms claim SKIP LOCKED batch50 -> deliver INSERT+DONE CAS
  -> retry 1s/5s/30s/120s max5 -> DLQ -> purge DONE 30d batch1000
client UX -> server-audit -> POST /api/audit-logs(allowlist 3 + 4K cap)
```
## Hop table
| # | Hop | File:Symbol | In->Out | Failure |
|---|---|---|---|---|
| 0 | Auth intercept | packages/auth/src/server/audit-plugin.ts:auditLogPlugin | admin path -> before guard+stash | Nested impersonation 403; non-success never writes |
| 1 | Session hooks | packages/auth/src/server/database-hooks.ts:databaseHooks | session create/delete -> writeAudit | Role/ban skipped here to avoid double-audit |
| 2 | Row build | apps/api/src/common/audit-writer.ts:buildAuditRowData | session+meta -> sanitized row | Server keys stripped before merge; capture-at-emit for impersonation |
| 3 | Enqueue | apps/api/src/common/audit-queue.service.ts:enqueueSessionAudit | tx-aware -> outbox INSERT idempotent | P2002 silent dedupe; PG down throws rolling back note |
| 4 | Claim | apps/api/src/common/audit-queue.service.ts:claimDueBatch | PENDING -> CLAIMED SKIP LOCKED | Expired CLAIMED reclaimed after 30s; CAS prevents double-write |
| 5 | Deliver | apps/api/src/common/audit-outbox.ts:OUTBOX_MAX_ATTEMPTS | claimed row -> auditLog INSERT + DONE | P2025 claim-lost skip; retry delays 1s/5s/30s/120s to DLQ |
| 6 | Purge | apps/api/src/common/audit-queue.service.ts:purgeDoneBatch | DONE>30d -> PK-delete 1000 hourly | Spares PENDING/CLAIMED/DLQ; drain 20s < grace 30s |
| 7 | Client path | apps/web/src/lib/server/server-audit.ts:callInternalApi | UX action -> POST audit-logs | Allowlist + cap enforced server-side; forwarder never throws |
## Files
- Fact: `audit-plugin.ts` plus `database-hooks.ts` own sync plane with `pending-storage.ts` stash plus `hierarchy.ts` guard.
- Fact: `audit-writer.ts` plus `audit-metadata.ts` own sanitize plus 4K cap plus token redaction.
- Fact: `audit-queue.service.ts` plus `audit-outbox.ts` own poll 250/50 plus claim plus deliver plus DLQ plus purge.
- Fact: `apps/api/src/audit/audit.service.ts` owns `recordFromSession` plus stable order plus tx snapshot read path.
## Failure branches
- Fact: Kill-9 before commit rolls back both note and outbox; mid-CLAIMED reclaimed after 30s timeout.
- Fact: Sync write uses `.catch(log)` post-commit best-effort; outbox uses throw-for-retry durable path.
- Fact: SIGTERM drains 20s vs stop grace 30s; `POLL_DISABLED` kill-switch stops poller without code change.
- Fact: DLQ accumulates poison rows; redrive is single-id SQL UPDATE to PENDING per runbook, never auto.
## Security + observability implications
- Fact: Attribution unforgeable: `userId` session-derived; client-set actor markers sanitized; no FK survives delete.
- Fact: Metrics `audit_queue_*` use max-not-sum for backlog; depth gauge refreshed after claim/deliver/purge.
- Interpretation: Summing depth across workers double-counts; alert on max plus DLQ non-empty separately.
- Uncertainty: FINAL-10 Q10 `audit_log.createdAt` is delivery time while `outbox.created_at` is enqueue time; skew under backlog misreads timelines. See FINAL-10 Q10.
## Linked invariants
- Recommendation: Enforced by [INV-005 Audit Planes](../invariants/05-audit-planes.md); tuning 250/50/30s/5/drain20 is normative.
- Recommendation: Related DLQ runbook in workflows/redrive-dlq plus read path stable order `createdAt+id`.
## Up link
- Fact: Up: `../00-INDEX.md`; routes T1,T8,T10; subsystems `audit` plus `auth-better-auth` plus `database-prisma`.
- Fact: Admin list path uses fresh-role gate plus atomic count+page to avoid shift under concurrent writes.
