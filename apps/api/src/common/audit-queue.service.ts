import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '@repo/database';
import { createLogger, withSpan } from '@repo/observability';

import type { ServerSession } from './session.utils';
import type { AuditClientMeta, AuditRowData, AuditRowInput } from './audit-writer';
import { buildAuditRowData } from './audit-writer';
import { MetricsService } from './observability/metrics.service';
import {
  OUTBOX_CLAIM_TIMEOUT_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_BATCH_SIZE,
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_PURGE_BATCH_SIZE,
  OUTBOX_PURGE_INTERVAL_MS,
  OUTBOX_RETENTION_DAYS,
  OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS,
  OUTBOX_STATUS,
  buildOutboxIdempotencyKey,
  isOutboxClaimExpired,
  outboxRetryDelayMs,
  outboxRowToAuditData,
  type ClaimedOutboxRow,
} from './audit-outbox';

/** Prisma transaction client (interactive-tx callback param). Structural typing keeps specs light. */
export type OutboxTxClient = {
  auditOutbox: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Transactional-outbox background audit writer.
 *
 * Replaces the in-memory FIFO: enqueue now INSERTs a durable
 * audit_outbox row (same-PG-transaction as the business mutation where the
 * caller passes tx - see NotesService), and a per-process poller (250ms,
 * batch 50, SKIP LOCKED) delivers rows to audit_log with retry + DLQ.
 *
 * Durability argument: kill -9 between enqueue-commit and delivery loses
 * NOTHING - the row is in PG; the next poll (this or any surviving worker,
 * or post-restart recovery in onModuleInit) redelivers it. kill -9 before
 * enqueue-commit loses nothing either (the business mutation rolls back
 * with it when same-tx; otherwise the client sees a failure and retries,
 * and the idempotency key dedupes the outbox).
 *
 * Stable writer API: enqueueSessionAudit(session, input, meta, opts?) keeps
 * its name and roles; it is now awaitable (durable-before-response). Metric
 * names are unchanged (audit_queue_*) so dashboards and alerts keep working.
 *
 * Ordering: claimed in (created_at, id) order per batch (best-effort FIFO);
 * GLOBAL cross-instance ordering is NOT guaranteed - identical to the
 * pre-outbox per-request awaits, which also interleaved across instances.
 *
 * What MUST NOT use this queue: role/ban/revoke/delete/impersonation audits
 * (auth tier, synchronous by design) and anything where the caller branches
 * on insert success (the queue is write-only by contract).
 */
const POLLER_ID = randomUUID();

@Injectable()
export class AuditQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('api.audit-queue');
  private pollTimer: NodeJS.Timeout | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopped = false;
  // Enqueue promises tracked so flush() and shutdown observe them.
  private readonly pendingEnqueues = new Set<Promise<void>>();

  constructor(
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  /**
   * Durable enqueue: INSERT the outbox row (or join the caller's tx when
   * opts.tx is provided - NotesService mutations commit note + outbox
   * atomically). Resolves once the row is COMMITTED. Duplicate idempotency
   * keys (P2002) resolve silently - the event is already queued.
   */
  async enqueueSessionAudit(
    session: ServerSession,
    input: AuditRowInput,
    meta: AuditClientMeta,
    opts?: { idempotencyKey?: string; tx?: OutboxTxClient },
  ): Promise<void> {
    const data = buildAuditRowData(session, input, meta);
    const metaNoteId =
      (data.metadata as { noteId?: unknown } | null | undefined)?.noteId ?? null;
    const seed: string | null =
      typeof metaNoteId === 'string' && metaNoteId
        ? metaNoteId
        : typeof data.userId === 'string' && data.userId
          ? data.userId
          : null;
    const idempotencyKey =
      opts?.idempotencyKey ??
      (seed && data.action === 'note_created'
        ? buildOutboxIdempotencyKey(data.action, seed)
        : buildOutboxIdempotencyKey(data.action, seed, true));
    const row = {
      idempotencyKey,
      action: data.action,
      userId: data.userId,
      actor: data.actor,
      metadata: (data.metadata ?? null) as unknown as Record<string, unknown> | null,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    };
    const client = (opts?.tx?.auditOutbox ?? db.auditOutbox) as {
      create: (args: { data: typeof row }) => Promise<unknown>;
    };
    const p = (async () => {
      try {
        await client.create({ data: row });
        // Depth is owned solely by refreshDepthGauge (post-batch / empty
        // poll). Recording 0 here clobbered the gauge on every enqueue.
        this.metricsService?.recordAuditQueueEnqueue(data.action);
      } catch (error) {
        if (isUniqueViolation(error)) return; // duplicate delivery - already queued
        this.metricsService?.recordAuditQueueFailed(data.action, false);
        this.logger.error(
          { action: data.action, userId: data.userId, err: error },
          'Audit outbox enqueue failed, row NOT queued',
        );
        throw error;
      }
    })();
    if (!opts?.tx) {
      // Non-transactional path: track so flush()/shutdown observe it. Inside
      // a caller tx the row commits with the mutation - nothing to track.
      this.pendingEnqueues.add(p);
      void p.then(
        () => this.pendingEnqueues.delete(p),
        () => this.pendingEnqueues.delete(p),
      );
    }
    return p;
  }

  /** Nest lifecycle: recover orphans immediately, then poll every 250ms. */
  onModuleInit(): void {
    if (process.env.AUDIT_OUTBOX_POLL_DISABLED === 'true') return;
    void this.processDueBatch().catch((err) =>
      this.logger.error({ err }, 'Audit outbox startup recovery failed'),
    );
    this.pollTimer = setInterval(() => {
      if (this.stopped) return;
      if (this.inFlight) return; // never overlap batches
      // Catch the finally-CHAIN (not the pre-finally promise): finally()
      // propagates rejections into a new promise, and an un-caught chain
      // crashes node from inside setInterval (seen in prod verify).
      // inFlight guards overlap: compare against the finally-CHAIN object
      // itself (tracked.finally() returns a NEW promise - comparing with the
      // pre-finally promise is never equal and wedges the poller after one
      // batch; caught in prod verify when rows sat PENDING across 1200 polls
      // while startup recovery delivered instantly).
      const tracked: Promise<unknown> = this.processDueBatch().catch((err) =>
        this.logger.error({ err }, 'Audit outbox poll batch failed'),
      );
      const chained: Promise<unknown> = tracked.finally(() => {
        if (this.inFlight === chained) this.inFlight = null;
      });
      this.inFlight = chained;
      // Observe the chain so its (already-handled) settlement is awaited.
      void chained.catch(() => undefined);
    }, OUTBOX_POLL_INTERVAL_MS);
    const t = this.pollTimer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
    // Retention purge: hourly DONE-row cleanup. First run fires
    // after one interval (never at boot — startup is for claim recovery).
    this.purgeTimer = setInterval(() => {
      if (this.stopped) return;
      void this.purgeDoneBatch().catch((err) =>
        this.logger.error({ err }, 'Audit outbox retention purge failed'),
      );
    }, OUTBOX_PURGE_INTERVAL_MS);
    const pt = this.purgeTimer as unknown as { unref?: () => void };
    if (typeof pt.unref === 'function') pt.unref();
  }

  /** Test hook: resolves when pending enqueues + all due rows are delivered. */
  async flush(): Promise<void> {
    if (this.pendingEnqueues.size > 0) {
      await Promise.allSettled([...this.pendingEnqueues]);
    }
    for (;;) {
      const progressed = await this.processDueBatch({ ignoreSchedule: true });
      if (this.pendingEnqueues.size > 0) {
        await Promise.allSettled([...this.pendingEnqueues]);
        continue;
      }
      if (!progressed) return;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
    await Promise.race([
      (async () => {
        if (this.inFlight) await this.inFlight.catch(() => undefined);
        await this.flush().catch(() => undefined);
      })(),
      delay(OUTBOX_SHUTDOWN_DRAIN_TIMEOUT_MS),
    ]);
  }
  /**
   * Claim + deliver one batch. Returns true when any row was processed
   * (flush() loops on it). Timer path respects nextAttemptAt; flush() forces
   * retries inline so tests never sleep through backoff.
   */
  async processDueBatch(opts?: { ignoreSchedule?: boolean }): Promise<boolean> {
    return withSpan('audit.outbox.poll', async () => {
      const rows = await this.claimDueBatch(opts?.ignoreSchedule ?? false);
      if (rows.length === 0) {
        // Refresh on empty polls too. Previously the gauge only
        // reset when a batch was claimed, so it stayed stale-high after the
        // queue drained (phantom depth in Grafana / false depth alerts).
        await this.refreshDepthGauge().catch(() => undefined);
        return false;
      }
      this.metricsService?.recordAuditQueueProcessingStatus(true);
      const batchStart = Date.now();
      try {
        for (const row of rows) {
          await this.deliverClaimedRow(row);
        }
        return true;
      } finally {
        this.metricsService?.recordAuditQueueProcessingStatus(false);
        this.metricsService?.recordAuditQueueDrainDuration(
          (Date.now() - batchStart) / 1000,
        );
        await this.refreshDepthGauge().catch(() => undefined);
      }
    });
  }

  /**
   * Atomic claim: one UPDATE..RETURNING with FOR UPDATE SKIP LOCKED so N
   * pollers (cluster workers, replicas) share work without blocking. Also
   * reclaims CLAIMED rows orphaned past the claim timeout (crash recovery).
   */
  private async claimDueBatch(ignoreSchedule: boolean): Promise<ClaimedOutboxRow[]> {
    // Timer path only takes rows whose next_attempt_at is due; flush()
    // (tests and shutdown) takes every PENDING row plus expired claims so
    // retries never sleep through backoff.
    const pending = OUTBOX_STATUS.PENDING;
    const claimed = OUTBOX_STATUS.CLAIMED;
    const schedulePredicate = ignoreSchedule
      ? 'a.status = ' + "'" + pending + "'"
      : "(a.status = '" + pending + "' AND a.next_attempt_at <= NOW())";
    const sql =
      'UPDATE audit_outbox AS o SET status = ' + "'" + claimed + "'" + ', claimed_by = $1, claimed_at = NOW() ' +
      'WHERE o.id IN (SELECT a.id FROM audit_outbox AS a WHERE ' + schedulePredicate +
      " OR (a.status = '" + claimed + "' AND a.claimed_at < NOW() - make_interval(secs => $2))" +
      ' ORDER BY a.created_at ASC, a.id ASC LIMIT $3 FOR UPDATE SKIP LOCKED' +
      ') RETURNING o.id, o.action, o.user_id AS "userId", o.actor,' +
      ' o.metadata, o.ip_address AS "ipAddress", o.user_agent AS "userAgent", o.attempts';
    // NOTE: call as a METHOD on db - detaching the reference (const q =
    // db.$queryRawUnsafe) loses `this` and crashes inside the Prisma runtime.
    const raw = await db.$queryRawUnsafe<ClaimedOutboxRow[]>(
      sql,
      POLLER_ID,
      OUTBOX_CLAIM_TIMEOUT_MS / 1000,
      OUTBOX_POLL_BATCH_SIZE,
    );
    return (raw ?? []).map((r) => ({
      id: String(r.id),
      action: String(r.action),
      userId: (r.userId as string | null) ?? null,
      actor: (r.actor as string | null) ?? null,
      targetId: null,
      metadata: r.metadata,
      ipAddress: (r.ipAddress as string | null) ?? null,
      userAgent: (r.userAgent as string | null) ?? null,
      attempts: Number(r.attempts ?? 0),
    }));
  }

  private async deliverClaimedRow(row: ClaimedOutboxRow): Promise<void> {
    const itemStart = Date.now();
    // Audit INSERT + ownership-CAS DONE-mark commit ATOMICALLY in
    // one Prisma $transaction (batch form: single implicit tx on one pooled
    // connection — safe in PgBouncer transaction mode; DATABASE_URL sets
    // pgbouncer=true so Prisma never holds the connection across awaits).
    //
    // Ownership CAS: the DONE update matches only
    // (id, status=CLAIMED, claimed_by=this poller). If a claim expired and
    // another worker reclaimed the row, P2025 aborts the batch and the
    // audit INSERT rolls back — the rightful claimant alone writes audit_log.
    // Without this guard, a stalled worker that resumes after the 30s claim
    // timeout could insert a second audit_log row (no unique key on audit_log).
    const payload = outboxRowToAuditData(row) as AuditRowData;
    try {
      await db.$transaction([
        db.auditLog.create({ data: payload as never }),
        db.auditOutbox.update({
          where: {
            id: row.id,
            status: OUTBOX_STATUS.CLAIMED,
            claimedBy: POLLER_ID,
          },
          data: { status: OUTBOX_STATUS.DONE },
        }),
      ]);
      this.metricsService?.recordAuditQueueProcessed(
        row.action,
        (Date.now() - itemStart) / 1000,
      );
    } catch (error) {
      // Claim lost to reclaim (P2025 on the ownership CAS): another worker
      // owns the row — do not touch attempts/status/metrics for it.
      if (isClaimLost(error)) {
        this.logger.warn(
          { action: row.action, outboxId: row.id },
          'Audit deliver skipped: claim no longer owned by this worker',
        );
        return;
      }
      const attempts = row.attempts + 1;
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        const dlq = await db.auditOutbox
          .updateMany({
            where: {
              id: row.id,
              status: OUTBOX_STATUS.CLAIMED,
              claimedBy: POLLER_ID,
            },
            data: {
              status: OUTBOX_STATUS.DLQ,
              attempts,
              lastError: truncateError(error),
            },
          })
          .catch(() => ({ count: 0 }));
        // count=0 → claim stolen; the new owner manages the row — skip DLQ metrics.
        if ((dlq as { count?: number }).count === 0) {
          this.logger.warn(
            { action: row.action, outboxId: row.id },
            'Audit DLQ transition skipped: claim no longer owned',
          );
          return;
        }
        this.metricsService?.recordAuditQueueFailed(row.action, true);
        this.logger.error(
          {
            action: row.action,
            userId: row.userId,
            outboxId: row.id,
            err: error,
            metadata: row.metadata,
            redrive: "UPDATE audit_outbox SET status='PENDING', attempts=0, next_attempt_at=NOW(), last_error=NULL WHERE id='" + row.id + "';",
          },
          'Audit log write failed after retries, row moved to DLQ',
        );
        return;
      }
      const notBefore = new Date(Date.now() + outboxRetryDelayMs(attempts));
      const rescheduled = await db.auditOutbox
        .updateMany({
          where: {
            id: row.id,
            status: OUTBOX_STATUS.CLAIMED,
            claimedBy: POLLER_ID,
          },
          data: {
            status: OUTBOX_STATUS.PENDING,
            attempts,
            nextAttemptAt: notBefore,
            claimedBy: null,
            claimedAt: null,
            lastError: truncateError(error),
          },
        })
        .catch(() => ({ count: 0 }));
      if ((rescheduled as { count?: number }).count === 0) {
        this.logger.warn(
          { action: row.action, outboxId: row.id },
          'Audit retry transition skipped: claim no longer owned',
        );
        return;
      }
      this.metricsService?.recordAuditQueueRetry(row.action);
      this.metricsService?.recordAuditQueueFailed(row.action, false);
      this.logger.warn(
        { action: row.action, attempt: attempts },
        'Audit log write failed, retrying',
      );
    }
  }

  private async refreshDepthGauge(): Promise<void> {
    const pending = await db.auditOutbox.count({
      where: { status: OUTBOX_STATUS.PENDING },
    });
    this.metricsService?.recordAuditQueueDepth(pending);
  }

  /**
   * Retention purge: delete DONE rows older than the retention
   * window, one bounded batch. findMany-then-deleteMany (instead of a single
   * deleteMany) keeps each statement fast and avoids long row locks on a hot
   * table: the SELECT hits the partial DONE/updated_at index, the DELETE hits
   * the PK. PENDING/CLAIMED/DLQ rows can never match the status predicate.
   * Returns the deleted count. Test hook + hourly timer both call this.
   */
  async purgeDoneBatch(nowMs: number = Date.now()): Promise<number> {
    const start = Date.now();
    try {
      const cutoff = new Date(nowMs - OUTBOX_RETENTION_DAYS * 86_400_000);
      const stale = await db.auditOutbox.findMany({
        where: { status: OUTBOX_STATUS.DONE, updatedAt: { lt: cutoff } },
        select: { id: true },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: OUTBOX_PURGE_BATCH_SIZE,
      });
      if (stale.length === 0) {
        this.metricsService?.recordAuditQueuePurged(0, (Date.now() - start) / 1000);
        return 0;
      }
      const deleted = await db.auditOutbox.deleteMany({
        where: { id: { in: stale.map((r) => r.id) } },
      });
      this.metricsService?.recordAuditQueuePurged(
        deleted.count,
        (Date.now() - start) / 1000,
      );
      this.logger.info(
        { purged: deleted.count, retentionDays: OUTBOX_RETENTION_DAYS },
        'Audit outbox retention purge completed',
      );
      return deleted.count;
    } catch (error) {
      this.logger.error({ err: error }, 'Audit outbox retention purge failed');
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** P2025 = record not found on update — ownership CAS missed (claim stolen). */
function isClaimLost(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

function truncateError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.slice(0, 1000);
}

export { isOutboxClaimExpired };
