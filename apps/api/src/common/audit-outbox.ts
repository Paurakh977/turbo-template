import { randomUUID } from "node:crypto";

/**
 * Transactional-outbox constants + pure helpers.
 *
 * Decision record (re-confirmed for THIS repo):
 * PG transactional outbox + SKIP LOCKED polling wins over Redis Streams,
 * BullMQ, RabbitMQ, LISTEN/NOTIFY, and Kafka because (a) the audit row can
 * commit in the SAME transaction as the business mutation (no 2PC, no
 * commit-then-publish loss window); (b) PG 16 is already operated/backed
 * up/monitored — every alternative adds a stateful service; (c) LISTEN is
 * explicitly lossy on disconnect (PG docs: notifications are not persisted);
 * (d) audit volume is low-rate domain/UX rows, well within a 250ms poll with
 * a partial index. No LISTEN anywhere in this design.
 *
 * Status machine: PENDING -> CLAIMED -> DONE, with CLAIMED -> PENDING on
 * retry (attempts+1, nextAttemptAt=now+backoff) and CLAIMED -> DLQ when
 * attempts are exhausted. CLAIMED rows older than CLAIM_TIMEOUT_MS are
 * reclaimable (crashed-worker recovery on every poll + at startup).
 *
 * Ordering: claimed in (created_at, id) order per batch (best-effort FIFO);
 * GLOBAL cross-instance ordering is NOT guaranteed — identical to the
 * pre-outbox per-request awaits, which also interleaved across instances.
 *
 * DLQ redrive (operator runbook):
 *   SELECT id, action, attempts, last_error FROM audit_outbox
 *     WHERE status = 'DLQ' ORDER BY created_at DESC LIMIT 50;
 *   UPDATE audit_outbox SET status = 'PENDING', attempts = 0,
 *     next_attempt_at = NOW(), last_error = NULL, claimed_by = NULL,
 *     claimed_at = NULL WHERE status = 'DLQ' AND id = ANY($1);
 */

export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  CLAIMED: 'CLAIMED',
  DONE: 'DONE',
  DLQ: 'DLQ',
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

// Poller tuning: 250ms bounds end-to-end audit latency well under the 5s
// gateway timeouts; batch 50 keeps a burst drain to a handful of polls.
export const OUTBOX_POLL_INTERVAL_MS = 250;
export const OUTBOX_POLL_BATCH_SIZE = 50;
// A CLAIMED row older than this is presumed orphaned (worker crashed between
// claim and DONE) and becomes reclaimable. 30s >> worst-case single-row
// latency (PG INSERT + retries), so live workers never lose a claim.
export const OUTBOX_CLAIM_TIMEOUT_MS = 30_000;
// 5 delivery attempts, then DLQ (terminal). Delays keep a PG-blip burst in
// the queue for ~3.5min total before giving up — strictly more durable than
// the old 3-attempt/600ms in-memory queue.
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000];
// Matches the compose stop_grace_period math (audit drain <= 20s).
export const OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS = 20_000;
// Retention purge: DONE rows older than this are deleted in
// batches. 30d of low-rate audit rows is small (tens of MB); the purge keeps
// the table + due-index tiny forever. PENDING/CLAIMED/DLQ rows are NEVER
// touched by the purge (status predicate), so a stuck backlog or DLQ
// investigation is never destroyed by retention.
export const OUTBOX_RETENTION_DAYS = Number(
  process.env.AUDIT_OUTBOX_RETENTION_DAYS ?? 30,
);
export const OUTBOX_PURGE_INTERVAL_MS = 3_600_000; // hourly
export const OUTBOX_PURGE_BATCH_SIZE = 1000;

/** Delay before the Nth retry (attempts = failures so far, 1-based). */
export function outboxRetryDelayMs(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, OUTBOX_RETRY_DELAYS_MS.length - 1));
  return OUTBOX_RETRY_DELAYS_MS[idx] ?? 120_000;
}

/**
 * Idempotency key builder. Deterministic when a natural seed exists
 * (note_created:<noteId> — a note is created exactly once, so a retried
 * enqueue collides instead of double-inserting). Per-event uniqueness
 * otherwise (updates/deletes legitimately re-fire per mutation).
 */
export function buildOutboxIdempotencyKey(
  action: string,
  seed?: string | null,
  unique = false,
): string {
  if (seed && !unique) return action + ':' + seed;
  return action + ':' + (seed ? seed + ':' : '') + randomUUID();
}

/** Minimal shape the poller needs from a claimed row. */
export type ClaimedOutboxRow = {
  id: string;
  action: string;
  userId: string | null;
  actor: string | null;
  targetId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  attempts: number;
};

/** Map a claimed outbox row to the audit_log INSERT payload. */
export function outboxRowToAuditData(row: ClaimedOutboxRow): {
  userId: string | null;
  action: string;
  actor: string | undefined;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
} {
  return {
    userId: row.userId,
    action: row.action,
    actor: row.actor ?? undefined,
    metadata: row.metadata ?? undefined,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

/** True when a CLAIMED row has outlived its owner (crash recovery). */
export function isOutboxClaimExpired(claimedAt: Date | null, nowMs: number): boolean {
  if (!claimedAt) return true;
  return nowMs - claimedAt.getTime() > OUTBOX_CLAIM_TIMEOUT_MS;
}
