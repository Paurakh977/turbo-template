import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { createLogger } from '@repo/observability';

/**
 * Optional Node.js cluster mode for the single API container.
 *
 * WHY: the bottleneck investigation proved the single event loop saturates
 * first (ELU 0.8-0.9 sustained at 400+ RPS; Node pool "waiting" explodes as a
 * secondary symptom because callbacks can't be pumped). Cluster mode runs N
 * event loops in ONE container — no extra replicas, no compose changes.
 *
 * WHAT IT IS / IS NOT:
 * - IS: N independent OS processes sharing the listen port (kernel
 *   round-robins accepts). Each worker runs the full Nest bootstrap: own OTel
 *   SDK, own Prisma pool (via PgBouncer), own audit-queue drain, own metrics.
 * - IS NOT Docker replicas: no separate healthchecks, no nginx rebalancing,
 *   memory is NOT shared (each worker has its own heap + pool).
 *
 * SAFETY (correctness unchanged):
 * - AuthN/AuthZ: sessions live in shared Redis, roles are re-read from PG per
 *   request — worker affinity is irrelevant, revocation stays immediate.
 * - Throttling: Redis-backed, shared across workers (same as replicas).
 * - Audit queue: per-worker sequential drain. Cross-worker global ordering was
 *   never provided (not even across replicas) — per-note causal order holds
 *   within a worker; acceptable per the queue's documented contract.
 * - Metrics: every worker pushes OTLP with the same service identity, so
 *   Prometheus sums them transparently. Per-worker ELU gauges reveal skew.
 *
 * CONFIG: API_WORKERS (default 1 = today's single-process behavior, bit for
 * bit). Capped at os.availableParallelism(). Documented in .env.example.
 */
/**
 * Pool math — two INDEPENDENT budgets (PgBouncer docs + pgbouncer.ini):
 *
 *   (client) workers × DATABASE_POOL_MAX ≤ PGBOUNCER_MAX_CLIENT_CONN
 *   (server) PGBOUNCER_DEFAULT_POOL_SIZE + PGBOUNCER_RESERVE_POOL_SIZE
 *              < POSTGRES_MAX_CONNECTIONS
 *
 * The client pool (Node pg.Pool per worker, default DATABASE_POOL_MAX=10)
 * consumes PgBouncer client slots (default MAX_CLIENT_CONN=500); the pooler
 * opens at most DEFAULT+RESERVE server connections toward Postgres
 * (defaults 25+5=30 < POSTGRES_MAX_CONNECTIONS=200). Comparing client demand
 * against the server pool (previous formula) is wrong: e.g. k6 values
 * 8 workers × 50 = 400 clients fits MAX_CLIENT_CONN=1000 and the server
 * peak 50+15=65 stays below 200, yet the old inequality (400 ≤ 65) rejects
 * it. k6 pool values live in .env.k6.example (50/1000/50/20/15).
 *
 * MAX_CLUSTER_WORKERS=8 matches the capacity matrix (API_WORKERS=1/2/4/8).
 * Past the machine's core count prefer horizontal replicas (separate
 * healthchecks, no shared-heap illusion); getWorkerCount() already caps at
 * os.availableParallelism().
 */
export const MAX_CLUSTER_WORKERS = 8;

export function getWorkerCount(): number {
  const raw = process.env.API_WORKERS?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(
    parsed,
    MAX_CLUSTER_WORKERS,
    Math.max(1, availableParallelism()),
  );
}

export async function runWithCluster(
  entry: () => Promise<void>,
): Promise<void> {
  const workers = getWorkerCount();
  const logger = createLogger('api.cluster');

  // Single process (default) or worker child: run the app directly.
  if (workers <= 1 || !cluster.isPrimary) {
    await entry();
    return;
  }

  logger.info({
    workers,
    cpus: availableParallelism(),
    msg: `Primary ${process.pid} forking ${workers} API workers`,
  });

  // Worker ids intentionally shut down (SIGTERM/SIGINT path) must NOT be
  // reforked; only unexpected exits refork with backoff. Docker's restart
  // policy remains the backstop for a crashing primary.
  const shuttingDown = new Set<number>();
  // Crash backoff: timestamps of unexpected exits (ms). >5 in 60s → primary
  // exits non-zero instead of fork-looping (lets compose restart with its
  // own backoff instead of hot-spinning).
  const crashTimestamps: number[] = [];
  const MAX_CRASHES = 5;
  const CRASH_WINDOW_MS = 60_000;
  let reforkTimer: NodeJS.Timeout | null = null;

  for (let i = 0; i < workers; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown.has(worker.id)) {
      shuttingDown.delete(worker.id);
      // Primary exits once all intentional shutdowns complete — otherwise
      // the primary would idle forever after workers drain (deploy hang).
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        logger.info({ msg: 'All workers exited, primary exiting' });
        process.exit(0);
      }
      return;
    }
    if (worker.exitedAfterDisconnect) return;
    const now = Date.now();
    crashTimestamps.push(now);
    while (
      crashTimestamps.length > 0 &&
      now - (crashTimestamps[0] ?? 0) > CRASH_WINDOW_MS
    ) {
      crashTimestamps.shift();
    }
    if (crashTimestamps.length > MAX_CRASHES) {
      logger.error({
        workerPid: worker.process.pid,
        code,
        signal,
        crashes: crashTimestamps.length,
        msg: 'Too many worker crashes, primary exiting (no refork)',
      });
      process.exit(1);
    }
    // Backoff: 1s × crashes (1s, 2s, ...) so a poison env doesn't hot-spin.
    const delayMs = 1000 * crashTimestamps.length;
    logger.warn({
      workerPid: worker.process.pid,
      code,
      signal,
      delayMs,
      msg: 'Worker exited unexpectedly, reforking with backoff',
    });
    if (reforkTimer) clearTimeout(reforkTimer);
    reforkTimer = setTimeout(() => cluster.fork(), delayMs);
    reforkTimer.unref?.();
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal, msg: 'Primary disconnecting workers for shutdown' });
    if (reforkTimer) {
      clearTimeout(reforkTimer);
      reforkTimer = null;
    }
    for (const worker of Object.values(cluster.workers ?? {})) {
      if (!worker) continue;
      shuttingDown.add(worker.id);
      // disconnect() stops new accepts + lets the worker drain (HTTP +
      // audit queue + OTel) before the signal kills it. Workers run
      // enableShutdownHooks + 20s queue drain; Docker gives 30s grace.
      try {
        worker.disconnect();
      } catch {
        // Already dead — exit handler reaps it.
      }
      worker.process.kill(signal);
    }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
