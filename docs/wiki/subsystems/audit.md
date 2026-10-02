---
title: "Subsystem: Audit (Dual Planes plus Outbox)"
type: subsystem
status: stable
authority: descriptive
owners: ["subsystems/audit.md"]
sources: ["packages/auth/src/server/audit-plugin.ts", "apps/api/src/common/audit-writer.ts", "apps/api/src/common/audit-metadata.ts", "apps/api/src/common/audit-queue.service.ts", "apps/api/src/common/audit-outbox.ts", "apps/api/src/audit/audit.controller.ts", "apps/api/src/audit/audit.service.ts"]
depends_on: ["invariants/05-audit-planes.md"]
guards: ["apps/api/src/common/audit-queue.service.spec.ts", "apps/api/src/common/audit-outbox.spec.ts", "packages/auth/src/server/stop-impersonation-audit.spec.ts", "apps/api/src/common/audit-metadata.spec.ts"]
updated: 2026-10-01
expires: null
superseded-by: null
template: true
---
# Subsystem: Audit (Dual Planes plus Outbox)
> Up: ../00-INDEX.md | Depends on: INV-05 (audit planes). Rules live in invariants, never copied here.
## 1. Ownership
**Fact:** Sync plane owned by packages/auth/src/server/audit-plugin.ts (739 lines, admin before-guards plus after-success writes) plus database-hooks.ts (305 lines, signup plus session plus delete lifecycle); durable plane owned by apps/api/src/common/audit-queue.service.ts (474 lines) plus audit-outbox.ts (125 lines) plus audit-writer.ts (106 lines) plus audit-metadata.ts (25 lines).
**Fact:** Storage owned by packages/database/prisma/models/auditLog.prisma plus auditOutbox.prisma with migrations 20260927080215_init and 20260927080325 retention index; read path owned by apps/api/src/audit/audit.service.ts plus audit.controller.ts; web forwarder owned by apps/web/src/lib/server/server-audit.ts (38 lines).
**Fact:** Queue module is Global singleton imported exactly once (audit-queue.module.ts:1-16); metrics flow to Prometheus alerts plus Grafana dashboards.
## 2. Runtime
**Fact:** Sync plane: writeAudit does db.auditLog.create with actor null-to-undefined coercion plus catch-log, awaited but never throws, so audit cannot fail the mutation (audit-plugin.ts:60-75); isSuccess gate (returned present, not APIError, Response only if 200) skips writes on failure and cleans stashes (audit-plugin.ts:39-50).
**Fact:** Durable plane: enqueueSessionAudit builds the row via buildAuditRowData snapshot at emit, inserts audit_outbox in the caller transaction when passed (notes create plus update plus delete same-tx atomic), idempotency note_created colon noteId deterministic else action seed uuid, P2002 silent success else metric plus throw so in-tx rolls back the note too (audit-queue.service.ts:84-142).
**Fact:** Poller: onModuleInit recovery plus setInterval 250ms unref plus inFlight no-overlap plus hourly purge; claimDueBatch single UPDATE RETURNING with FOR UPDATE SKIP LOCKED order by created_at id limit 50 plus 30s reclaim; deliverClaimedRow atomic auditLog.create plus outbox DONE in one batch transaction with ownership CAS (P2025 stolen-claim skip), retry backoff 1s 5s 30s 120s to 5 attempts then DLQ (audit-queue.service.ts:145-402).
**Fact:** Read: listForAdmin asserts admin via fresh-role plus effective id deny-by-default, atomic count plus page with stable order createdAt desc id desc, ID-pattern split plus fuzzy email ILIKE capped 300, purge DONE-only 30d bounded 1000 PK-delete (audit.service.ts:120-242, audit-queue.service.ts:419-449).
## 3. Public API
| Surface | Contract | Source |
|---|---|---|
| enqueueSessionAudit | tx-aware durable write, deterministic key for creates, UUID for refireable | audit-queue.service.ts:84-142 |
| POST api/audit-logs | Allowlist profile_updated, theme_changed, labs_toggled only, metadata 4K cap | audit.controller.ts:34-79 |
| GET api/admin/audit-logs | Admin-only listing with action filter, q truncation, page clamp | audit.service.ts:120-242 |
**Fact:** Attribution is unforgeable: userId always session-derived (audit-writer.ts:71), server keys stripped BEFORE merge then impersonation markers stamped after (audit-metadata.ts:16-25); web forwarder sends no identity and swallows errors to console only.
## 4. Dependency direction
**Fact:** Allowed: domain services into queue plus writer; auth hooks into db.auditLog direct; controller into audit.service recordFromSession (queued in prod, direct-write test fallback); poller into Prisma batch transaction.
**Fact:** Forbidden: role, ban, revoke, delete, impersonation audits MUST NOT use the queue (audit-queue.service.ts header); domain high-volume MUST NOT use sync direct writes; clients MUST NOT set actor or impersonation markers; redrive is SQL only, never auto.
| Check | Grep |
|---|---|
| No queue misuse | rg -n enqueueSessionAudit apps/api/src, confirm only domain and UX writers |
| Allowlist tight | rg -n CLIENT_AUDIT_ACTIONS apps/api/src/audit, expect 3 UX actions |
| Sanitizer order | rg -n sanitizeAuditMetadata apps/api/src/common/audit-writer.ts, expect before merge |
## 5. Security posture
**Fact:** Attribution unforgeable: userId session-derived (audit-writer.ts:71); web sends no hints (server-audit.ts); allowlist 3 UX actions (audit.controller.ts:34-38); sanitizer strips server keys (audit-metadata.ts:1-14).
**Fact:** IP anti-spoof: auth right-to-left CIDR walk abort-on-malformed with TRUSTED_PROXY_CIDRS 10/8, 172.16/12, 192.168/16, loopback (client-ip.ts:106-131); API trust proxy 1 fallback (client-meta.ts:17-27).
**Fact:** Token redaction: session_revoked stores redacted marker (audit-plugin.ts:503); admin gate fresh DB role deny-by-default with effective id (audit.service.ts:244-255); no FK audit to user (migration init) so audit survives hard delete; DLQ logs include metadata plus redrive SQL with PII redaction in pipeline.
**Recommendation:** Never add privilege actions to CLIENT_AUDIT_ACTIONS; keep MAX_METADATA_CHARS in sync with new UX events.
## 6. Failure modes
**Fact:** Guarantee ladder strongest to weakest: same-tx notes atomic (kill-9 before commit rolls back both, after redelivers); outbox at-least-once plus CAS no dup; non-tx standalone may diverge; auth sync best-effort swallow; web forwarder weakest console-error only.
**Fact:** Kill-9 before commit with retry dedupes via note_created id; between commit and deliver next poll plus startup recovery redelivers (audit-queue.service.ts:144-149); mid-CLAIMED reclaimed after 30s every poll.
**Fact:** SIGTERM disconnect plus drain 20s inFlight plus flush race (cluster.ts:146-167, audit-queue.service.ts:200-217) versus grace 30s compose; SIGKILL same as mid-CLAIMED.
**Fact:** Redis down to memory fallback single-instance ok, multi-instance may skip or duplicate (pending-storage.ts:101-170); PG down on enqueue logged NOT queued plus rethrow rolling back the note in-tx (audit-queue.service.ts:122-130); deliver path backs off then DLQ with lastError 1000 chars; auth write silent loss accepted; API down maps 503/504 then swallowed UX loss.
## 7. Performance
**Fact:** Indexes cover hot paths: audit_log 4 plus outbox due plus fifo plus partial DONE (auditLog.prisma:14-20, init migration, 20260927080325 migration 9-11).
**Fact:** Poll 250ms batch 50 SKIP LOCKED bounds latency under 5s gateway (audit-outbox.ts:42-43, fetch-internal.ts timeout); mutation saves 1 RTT background; sync auth rare single-digit per min (audit-writer.ts:23-29).
**Fact:** Read atomic count plus page, USER_SEARCH_TAKE 300, ID_PATTERN split, empty-guard skips user lookup (audit.service.ts:100-119,138-185,224-232); purge hourly 1000 PK-delete avoids long locks; metrics audit_queue stable names feed alerts plus Grafana with max-not-sum rule.
## 8. Config/Env
**Fact:** AUDIT_OUTBOX_RETENTION_DAYS default 30 import-time (audit-outbox.ts:62-64); AUDIT_OUTBOX_POLL_DISABLED true kill-switch (audit-queue.service.ts:146) listed in .env.example plus turbo.json.
**Fact:** stop_grace 30s compose must exceed DRAIN 20s (audit-outbox.ts:55-56, cluster.ts:152-164); INTERNAL_API_URL fail-fast (fetch-internal.ts:56-67) with NEXT_PUBLIC_APP_URL Origin and 5000 timeout.
**Fact:** TRUSTED_PROXY_CIDRS (client-ip.ts:32-40) syncs with Better Auth trustedProxies; API trust proxy 1 in main.ts per client-meta.ts:7; DATABASE_URL pooler 6432 plus pgbouncer true versus DIRECT_URL 5432 compose; batch tx relies on it (audit-queue.service.ts:293-297).
## 9. Testing/verification
**Fact:** audit-outbox.spec.ts pins POLL 250 plus BATCH 50 plus CLAIM 30s plus MAX 5, retry delays, key builder, expiry boundary.
**Fact:** audit-queue.service.spec.ts covers P2002 silent versus throw plus metric, atomic deliver order, P2025 skip, DLQ after MAX with DLQ status, retry reschedule, shutdown drain, depth-not-clobbered, POLL_DISABLED kill-switch.
**Fact:** audit.service.spec.ts plus audit.controller.spec.ts cover transaction mock shape, allowlist 400, 4K cap, clamp refetch; server-audit.spec.ts forwarder never throws; stop-impersonation-audit.spec.ts plus pending-storage specs exactly-one-row plus GETDEL atomicity plus TTL; audit-metadata.spec.ts strips server keys.
**Fact:** flush in audit-queue.service.ts:186-198 drains enqueues plus loops ignoreSchedule so tests skip backoff sleeps.
**Recommendation:** Add kill-9 restart redelivery, DLQ redrive round-trip, purge spares PENDING and DLQ tests.
## 10. Extension pointer
**Recommendation:** New background event (for example comment_created): use buildAuditRowData never hand-roll; enqueue with tx plus deterministic key only if exactly-once; bounded metric label; spec key plus P2002. Web-originated needs CLIENT_AUDIT_ACTIONS plus cap test.
**Recommendation:** New admin event: before guard plus stash plus after isSuccess plus write plus invalidate pair in audit-plugin.ts plus span plus exactly-once spec.
**Recommendation:** New read filter: where plus covering index in auditLog.prisma plus migration; keep tie-breaker plus truncation plus ID split. DLQ ops documented SQL only, no auto-redrive; consider admin-gated dry-run endpoint later.
## 11. AI-guidance
MUST: send high-volume through enqueueSessionAudit with tx in transaction; preserve SKIP LOCKED plus CAS plus POLLER_ID plus queryRawUnsafe method call; keep DONE predicate plus bounded purge plus partial index; keep drain 20s below grace 30s; keep timers unrefd; keep module Global singleton.
MUST-NOT: branch on queue success (write-only); add privilege to CLIENT_AUDIT_ACTIONS; store stop flag in after; sum depth gauge (max only); assume global FIFO; read leftmost XFF; use sessionId as Redis key.
## 12. Common mistakes
**Interpretation:** Auth create is POST-commit swallow not in-tx, so loss is possible while the mutation succeeds; only notes are atomic.
**Interpretation:** Adding role or ban to databaseHooks.update.after double-audits; ownership stays plugin.after only.
**Interpretation:** Storing stop suppression in after is too late and yields two rows; it must be before (audit-plugin.ts:239-264).
**Interpretation:** Comparing inFlight pre-finally wedges the poller; compare the chain object (audit-queue.service.ts:152-167 prod verify).
**Interpretation:** Recording depth 0 on enqueue clobbers the gauge; depth is owned by refreshDepthGauge only.
## 13. Related
INV-05 (pointer only). Flows: flows/audit.md (future). Workflows: add-domain-module.md, redrive-dlq.md, debug-prod.md (future). Reference: audit-events.md (future). ADRs: ADR-0002 PG outbox not broker (future). Subsystems: auth-better-auth.md (sync writers), rbac-rules-users.md (gates), security.md (sanitization).
## 14. Refs
packages/auth/src/server/audit-plugin.ts, server/database-hooks.ts, server/pending-storage.ts, shared/client-ip.ts, common/audit-queue.service.ts, common/audit-outbox.ts, common/audit-writer.ts, common/audit-metadata.ts, common/audit-queue.module.ts, database/prisma/models/auditLog.prisma, database/prisma/models/auditOutbox.prisma, migrations 20260927080215_init plus 20260927080325, audit/audit.service.ts, audit/audit.controller.ts, notes/notes.service.ts, web/lib/server/server-audit.ts plus internal-api.ts plus fetch-internal.ts, common/session.utils.ts, common/client-meta.ts, cluster.ts, docker-compose.yml.
> **Uncertainty:** targetId is always NULL; no writer sets it (hardcoded null in claim path, auth never passes). Dead versus future is undecided. See .agent/wiki-discovery/FINAL-10-OPEN-QUESTIONS.md Q6; ADR to populate (user or note ids) or migrate to drop, do not repurpose silently.
> **Uncertainty:** Overlong user-agent is TEXT uncapped; only metadata is 4K-capped. Row bloat via hostile UA is possible. See FINAL-10-OPEN-QUESTIONS.md Q7; add 1K truncate plus test before relying on the cap.
> **Uncertainty:** audit-plugin in-process maps have no TTL or sweep for aborted requests. See FINAL-10-OPEN-QUESTIONS.md Q8; finally-cleanup or TTL plus size assert needed.
> **Uncertainty:** DLQ has no alert, dashboard, or endpoint; poison rows sit invisible with only BacklogHigh max above 500. See FINAL-10-OPEN-QUESTIONS.md Q9; add AuditQueueDLQNonEmpty plus runbook link plus admin count.
> **Uncertainty:** audit_log.createdAt is delivery time while outbox.created_at is enqueue time; forensic timelines skew under backlog or DLQ. See FINAL-10-OPEN-QUESTIONS.md Q10; expose both in admin UI before asserting order.
### Status machine and tuning reference
| Transition | Trigger | Bound |
|---|---|---|
| PENDING to CLAIMED | poll claim batch with SKIP LOCKED | 250ms poll, batch 50, fifo created_at id |
| CLAIMED to DONE | atomic auditLog.create plus outbox DONE with CAS | single batch transaction, PgBouncer safe |
| CLAIMED to PENDING | deliver error with attempts left | backoff 1s 5s 30s 120s, 30s reclaim |
| CLAIMED to DLQ | attempts at 5 | terminal plus metric plus inline redrive SQL |
| DONE to purged | retention sweep | 30d, hourly, 1000 PK-delete, DONE-only predicate |
| PENDING to DONE | never direct | always via CLAIMED ownership |
**Fact:** Global order is never promised; FIFO is best-effort per batch across N per-worker pollers with distinct POLLER_ID.
**Fact:** P2002 on enqueue is success (duplicate deterministic key); P2025 on deliver is stolen-claim skip that never touches attempts.
### Producer and consumer reference
| Producer | Plane | Key | Atomicity |
|---|---|---|---|
| notes create update delete | outbox durable | note_created id else UUID | same-tx with row write |
| profile theme labs UX | outbox durable | UUID refireable | non-tx standalone |
| role ban revoke delete impersonation | sync direct | not applicable admin once | post-commit best-effort |
| signup email session lifecycle | sync direct | not applicable | fire-and-forget |
### DLQ and purge runbook pointer
**Fact:** Canonical redrive SQL lives in audit-outbox.ts:26-30 and inline in audit-queue.service.ts:364: select DLQ limit 50, inspect, single-id update to PENDING with attempts 0 and cleared claim columns, verify, never auto-redrive.
**Fact:** Purge uses findMany DONE older than cutoff take 1000 then deleteMany by PK to avoid long locks; PENDING plus CLAIMED plus DLQ never match the predicate.
**Recommendation:** Keep max-not-sum on audit_queue depth alerts; summing per-worker gauges overcounts backlog.
### Schema and index reference
**Fact:** AuditLog maps to audit_log with 4 indexes (createdAt desc id desc, userId plus createdAt desc, actor plus createdAt desc, action plus createdAt desc plus id desc); no FK to user so rows survive hard delete and listForAdmin tolerates missing users.
**Fact:** AuditOutbox maps to audit_outbox with UNIQUE idempotency_key plus due index on status plus nextAttemptAt plus fifo index on createdAt id; partial DONE purge index is SQL-only since Prisma index cannot express predicates (20260927080325 migration).
**Fact:** Both tables plus indexes are created in 20260927080215_init migration; retention index added transactionally re-runnable with IF NOT EXISTS in 20260927080325.
### Verification commands
**Fact:** Run audit-outbox.spec plus audit-queue.service.spec plus audit.service and controller specs plus audit-metadata.spec plus stop-impersonation-audit.spec for the full plane matrix.
**Recommendation:** Document RETENTION_DAYS in .env.example and log effective tuning at startup so poll versus purge drift is visible in deploys.
**Recommendation:** Keep OTel AuthAttributes ACTION plus STATUS plus TARGET_USER_ID behind isRecording guards for the ended-span race noted in both hook files.
### Coupling notes
**Fact:** Upstream drivers are the BetterAuth plugin internalAdapter with-hooks, Nest APP_GUARD plus Session, Express trust proxy plus nginx XFF for IP, and INTERNAL_API_URL plus cookies for web identity.
**Fact:** Downstream readers are the append-only audit_log via listForAdmin plus UI, per-worker outbox polling by POLLER_ID, queue metrics into alerts plus dashboards, and OTel auth attributes plus audit spans.
**Recommendation:** Treat audit as load-bearing for compliance, not for mutation correctness; it degrades to log plus retry plus DLQ and never fails the operation except the in-tx rethrow that preserves atomicity.
