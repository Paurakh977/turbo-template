import { jest } from '@jest/globals';

const outboxCreate = jest.fn();
const outboxUpdate = jest.fn();
const outboxCount = jest.fn();
const outboxFindMany = jest.fn();
const outboxDeleteMany = jest.fn();
const auditLogCreate = jest.fn();
const prismaTransaction = jest.fn();
const queryRawUnsafe = jest.fn();
const persistMock = jest.fn();

const outboxUpdateMany = jest.fn();

jest.mock('@repo/database', () => ({
  db: {
    auditOutbox: {
      create: (...args: unknown[]) => outboxCreate(...(args as [])),
      update: (...args: unknown[]) => outboxUpdate(...(args as [])),
      updateMany: (...args: unknown[]) => outboxUpdateMany(...(args as [])),
      count: (...args: unknown[]) => outboxCount(...(args as [])),
      findMany: (...args: unknown[]) => outboxFindMany(...(args as [])),
      deleteMany: (...args: unknown[]) => outboxDeleteMany(...(args as [])),
    },
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...(args as [])),
    },
    $transaction: (...args: unknown[]) => prismaTransaction(...(args as [])),
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...(args as [])),
  },
}));

jest.mock('@repo/observability', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: (...args: unknown[]) => logError(...(args as [])),
    warn: (...args: unknown[]) => logWarn(...(args as [])),
    debug: jest.fn(),
  })),
  withSpan: jest.fn((_name: unknown, fn: unknown) =>
    typeof fn === 'function' ? (fn as (span: unknown) => unknown)({}) : undefined,
  ),
}));

const logError = jest.fn();
const logWarn = jest.fn();

// Real builder (attribution/sanitization under test) + controllable persist.
jest.mock('../common/audit-writer', () => {
  const actual = jest.requireActual('../common/audit-writer') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    persistAuditRowData: (...args: unknown[]) =>
      persistMock(...(args as [])),
  };
});

import { AuditQueueService } from './audit-queue.service';
import { OUTBOX_MAX_ATTEMPTS } from './audit-outbox';

function makeSession(opts: { userId?: string; impersonatedBy?: string | null } = {}) {
  return {
    user: { id: opts.userId ?? 'user-1' },
    session: { impersonatedBy: opts.impersonatedBy ?? null },
  } as never;
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'out-1',
    action: 'note_created',
    userId: 'u1',
    actor: null,
    targetId: null,
    metadata: { noteId: 'n1' },
    ipAddress: '1.2.3.4',
    userAgent: 'ua',
    attempts: 0,
    ...overrides,
  };
}
describe('AuditQueueService (Phase 8 transactional outbox)', () => {
  let queue: AuditQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUDIT_OUTBOX_POLL_DISABLED = 'true';
    persistMock.mockResolvedValue(undefined);
    outboxCreate.mockResolvedValue({ id: 'out-1' });
    outboxUpdate.mockResolvedValue({});
    outboxUpdateMany.mockResolvedValue({ count: 1 });
    outboxCount.mockResolvedValue(0);
    outboxFindMany.mockResolvedValue([]);
    outboxDeleteMany.mockResolvedValue({ count: 0 });
    auditLogCreate.mockResolvedValue({ id: 'audit-1' });
    // Batch $transaction executes the (mocked) ops in order so failure
    // injection through auditLogCreate/outboxUpdate behaves like PG.
    // On P2025 from the ownership CAS, reject the batch (real PG rolls back
    // the prior audit INSERT — the mock cannot roll back already-resolved
    // promises, so tests assert where-clauses + skip-side-effects instead).
    prismaTransaction.mockImplementation(async (ops: unknown) => {
      const results: unknown[] = [];
      for (const op of ops as unknown[]) results.push(await op);
      return results;
    });
    queryRawUnsafe.mockResolvedValue([]);
    queue = new AuditQueueService();
  });

  it('inserts a durable outbox row with session attribution frozen at enqueue time', async () => {
    await queue.enqueueSessionAudit(
      makeSession({ userId: 'u1', impersonatedBy: 'admin-9' }),
      { action: 'note_created', metadata: { noteId: 'n1' } },
      { ip: '1.2.3.4', userAgent: 'ua' },
    );

    expect(outboxCreate).toHaveBeenCalledTimes(1);
    const data = outboxCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data).toMatchObject({
      action: 'note_created',
      userId: 'u1',
      actor: 'admin-9',
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
      idempotencyKey: 'note_created:n1',
    });
    expect(data.data.metadata).toMatchObject({
      noteId: 'n1',
      performedViaImpersonation: true,
      impersonatedBy: 'admin-9',
    });
  });

  it('strips forged impersonation markers from client metadata', async () => {
    await queue.enqueueSessionAudit(
      makeSession({ userId: 'u1' }),
      {
        action: 'theme_changed',
        metadata: {
          theme: 'dark',
          performedViaImpersonation: true,
          impersonatedBy: 'mallory',
        },
      },
      { ip: null, userAgent: null },
    );

    const data = outboxCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.data.actor).toBeUndefined();
    expect(data.data.metadata).toEqual({ theme: 'dark' });
  });

  it('dedupes duplicate delivery on the idempotency key (P2002 resolves silently)', async () => {
    outboxCreate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      queue.enqueueSessionAudit(makeSession(), { action: 'x' }, { ip: null, userAgent: null }),
    ).resolves.toBeUndefined();
    expect(logError).not.toHaveBeenCalled();
  });

  it('claims with SKIP LOCKED and delivers in claim order', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([claimedRow({ id: 'o1' }), claimedRow({ id: 'o2', action: 'b' })])
      .mockResolvedValue([]);

    await queue.flush();

    const firstCall = queryRawUnsafe.mock.calls[0] as unknown[];
    expect(String(firstCall[0])).toMatch('SKIP LOCKED');
    expect(String(firstCall[0])).toMatch('make_interval');
    expect(firstCall[1]).toEqual(expect.any(String));
    expect(firstCall[2]).toBe(30);
    expect(firstCall[3]).toBe(50);

    expect(persistMock).not.toHaveBeenCalled();
    expect(prismaTransaction).toHaveBeenCalledTimes(2);
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
    // Atomic deliver: audit INSERT + DONE-mark commit in ONE $transaction —
    // a crash can never leave the audit written but the row unmarked.
    const txOps = prismaTransaction.mock.calls[0] as unknown[][];
    expect(txOps[0]).toHaveLength(2);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'note_created', userId: 'u1' }),
    });
    // Ownership CAS: DONE update must match only this poller's live claim.
    const doneUpdate = outboxUpdate.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(doneUpdate.where).toMatchObject({
      id: 'o1',
      status: 'CLAIMED',
      claimedBy: expect.any(String),
    });
    expect(doneUpdate.data).toMatchObject({ status: 'DONE' });
  });

  it('does not mark DONE or insert audit when the ownership CAS misses (claim stolen)', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([claimedRow({ id: 'stolen' })])
      .mockResolvedValue([]);
    // Batch $transaction: audit create runs first; ownership update throws
    // P2025 → whole batch rolls back (mock does not roll back, so assert
    // the CAS where-clause and that retry/DLQ paths are NOT taken).
    outboxUpdate.mockImplementationOnce(() => {
      const err = new Error('Record to update not found.') as Error & {
        code: string;
      };
      err.code = 'P2025';
      throw err;
    });

    await queue.flush();

    const doneUpdate = outboxUpdate.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(doneUpdate.where).toMatchObject({
      id: 'stolen',
      status: 'CLAIMED',
      claimedBy: expect.any(String),
    });
    // Claim lost → no retry scheduling, no DLQ, no failure metrics.
    expect(outboxUpdateMany).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'stolen' }),
      expect.stringContaining('claim no longer owned'),
    );
    expect(logError).not.toHaveBeenCalled();
  });
  it('invokes the claim query as a method on db (this-binding)', async () => {
    let capturedThis: unknown = null;
    const { db } = jest.requireMock('@repo/database') as {
      db: Record<string, unknown>;
    };
    const original = db.$queryRawUnsafe;
    (db as Record<string, unknown>).$queryRawUnsafe = function (
      this: unknown,
      ...args: unknown[]
    ) {
      capturedThis = this;
      return (queryRawUnsafe as unknown as (...a: unknown[]) => unknown)(...args);
    };
    queryRawUnsafe.mockResolvedValueOnce([]);
    try {
      await queue.flush();
    } finally {
      (db as Record<string, unknown>).$queryRawUnsafe = original;
    }
    expect(capturedThis).toBe(db);
  });

  it('retries transient failures with backoff scheduling without losing the row', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([claimedRow({ attempts: 0 })])
      .mockResolvedValueOnce([claimedRow({ attempts: 1 })])
      .mockResolvedValue([]);
    auditLogCreate
      .mockRejectedValueOnce(new Error('pg blip'))
      .mockResolvedValueOnce({ id: 'audit-1' });

    await queue.flush();

    expect(auditLogCreate).toHaveBeenCalledTimes(2);
    expect(logWarn).toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'out-1', status: 'CLAIMED' }),
      data: expect.objectContaining({ status: 'PENDING', attempts: 1 }),
    });
  });

  it('delivers audit INSERT + DONE-mark in one transaction, retrying cleanly on tx failure', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([claimedRow({ id: 'o1' })])
      .mockResolvedValueOnce([claimedRow({ id: 'o1' })])
      .mockResolvedValue([]);
    // A failed $transaction rolls back BOTH writes in PG (the unit mock
    // executes ops in order, so the rejected create aborts the batch): the
    // row is rescheduled PENDING and the retry delivers exactly once.
    auditLogCreate
      .mockRejectedValueOnce(new Error('pg blip'))
      .mockResolvedValue({ id: 'audit-1' });

    await queue.flush();

    expect(prismaTransaction).toHaveBeenCalledTimes(2);
    for (const call of prismaTransaction.mock.calls as unknown[][]) {
      expect(call[0]).toHaveLength(2);
    }
    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'o1', status: 'CLAIMED' }),
      data: expect.objectContaining({ status: 'PENDING', attempts: 1 }),
    });
    expect(auditLogCreate).toHaveBeenCalledTimes(2);
  });

  it('moves the row to DLQ after exhausting retries, then keeps draining', async () => {
    queryRawUnsafe
      .mockResolvedValueOnce([
        claimedRow({ id: 'lost', userId: 'lost', attempts: OUTBOX_MAX_ATTEMPTS - 1 }),
        claimedRow({ id: 'kept', userId: 'kept', action: 'y' }),
      ])
      .mockResolvedValue([]);
    auditLogCreate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ id: 'audit-1' });

    await queue.flush();

    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'lost', status: 'CLAIMED' }),
      data: expect.objectContaining({ status: 'DLQ', attempts: OUTBOX_MAX_ATTEMPTS }),
    });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'lost', outboxId: 'lost' }),
      expect.stringContaining('DLQ'),
    );
    // Two atomic deliveries attempted: the failed tx (rolled back, row to
    // DLQ) and the successful one for the surviving row.
    expect(prismaTransaction).toHaveBeenCalledTimes(2);
  });

  it('records metrics for enqueue, processing, retries, DLQ, and drain duration', async () => {
    const mockMetricsService = {
      recordAuditQueueEnqueue: jest.fn(),
      recordAuditQueueProcessed: jest.fn(),
      recordAuditQueueRetry: jest.fn(),
      recordAuditQueueFailed: jest.fn(),
      recordAuditQueueDepth: jest.fn(),
      recordAuditQueueProcessingStatus: jest.fn(),
      recordAuditQueueDrainDuration: jest.fn(),
    };
    const instrumentedQueue = new AuditQueueService(mockMetricsService as never);

    queryRawUnsafe
      .mockResolvedValueOnce([claimedRow({ action: 'note_updated' })])
      .mockResolvedValueOnce([claimedRow({ action: 'note_updated', attempts: 1 })])
      .mockResolvedValue([]);
    auditLogCreate
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValue({ id: 'audit-1' });

    await instrumentedQueue.enqueueSessionAudit(
      makeSession({ userId: 'u1' }),
      { action: 'note_updated' },
      { ip: '1.1.1.1', userAgent: 'test' },
    );
    expect(mockMetricsService.recordAuditQueueEnqueue).toHaveBeenCalledWith(
      'note_updated',
    );
    // Enqueue must not clobber audit_queue_depth (depth owned by refreshDepthGauge).
    expect(mockMetricsService.recordAuditQueueDepth).not.toHaveBeenCalledWith(0);

    await instrumentedQueue.flush();

    expect(mockMetricsService.recordAuditQueueRetry).toHaveBeenCalledWith('note_updated');
    expect(mockMetricsService.recordAuditQueueProcessed).toHaveBeenCalledWith(
      'note_updated',
      expect.any(Number),
    );
    expect(mockMetricsService.recordAuditQueueProcessingStatus).toHaveBeenCalledWith(true);
    expect(mockMetricsService.recordAuditQueueProcessingStatus).toHaveBeenCalledWith(false);
    expect(mockMetricsService.recordAuditQueueDrainDuration).toHaveBeenCalledWith(
      expect.any(Number),
    );
  });

  it('refreshes the depth gauge on empty polls so it cannot stick high after drain', async () => {
    const mockMetricsService = {
      recordAuditQueueEnqueue: jest.fn(),
      recordAuditQueueProcessed: jest.fn(),
      recordAuditQueueRetry: jest.fn(),
      recordAuditQueueFailed: jest.fn(),
      recordAuditQueueDepth: jest.fn(),
      recordAuditQueueProcessingStatus: jest.fn(),
      recordAuditQueueDrainDuration: jest.fn(),
    };
    const instrumentedQueue = new AuditQueueService(mockMetricsService as never);

    // Claim returns nothing (queue drained) while 127 rows were
    // reported earlier. The empty poll must still recount and reset the
    // gauge instead of returning early with the stale value.
    outboxCount.mockResolvedValueOnce(0);
    queryRawUnsafe.mockResolvedValue([]);

    await instrumentedQueue.flush();

    expect(outboxCount).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(mockMetricsService.recordAuditQueueDepth).toHaveBeenCalledWith(0);
  });

  it('purges only DONE rows older than retention, in id order, bounded batch', async () => {
    outboxFindMany.mockResolvedValueOnce([{ id: 'old-1' }, { id: 'old-2' }]);
    outboxDeleteMany.mockResolvedValueOnce({ count: 2 });

    const purged = await queue.purgeDoneBatch();

    expect(purged).toBe(2);
    expect(outboxFindMany).toHaveBeenCalledWith({
      where: {
        status: 'DONE',
        updatedAt: { lt: expect.any(Date) },
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    // Retention window respected: cutoff is ~30d in the past.
    const cutoff = (
      outboxFindMany.mock.calls[0][0] as {
        where: { updatedAt: { lt: Date } };
      }
    ).where.updatedAt.lt;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(29 * 86_400_000);
    expect(outboxDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1', 'old-2'] } },
    });
  });

  it('purge never touches PENDING/CLAIMED/DLQ rows and no-ops on empty batch', async () => {
    outboxFindMany.mockResolvedValueOnce([]);

    const purged = await queue.purgeDoneBatch();

    expect(purged).toBe(0);
    const where = (
      outboxFindMany.mock.calls[0][0] as { where: Record<string, unknown> }
    ).where;
    expect(where.status).toBe('DONE');
    expect(outboxDeleteMany).not.toHaveBeenCalled();
  });

  it('shutdown drains pending enqueues and in-flight batches before exit', async () => {
    queryRawUnsafe.mockResolvedValueOnce([claimedRow({ id: 'shutdown-1' })]);
    const enqueue = queue.enqueueSessionAudit(
      makeSession(),
      { action: 'theme_changed' },
      { ip: null, userAgent: null },
    );

    await queue.onModuleDestroy();
    await enqueue;

    // flush() inside onModuleDestroy delivered the claimed row atomically
    // while the concurrent enqueue resolved via outbox create.
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'note_created' }),
    });
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('reclaims expired CLAIMED rows on flush (crashed-worker recovery)', async () => {
    queryRawUnsafe.mockResolvedValueOnce([claimedRow({ id: 'orphan' })]).mockResolvedValue([]);

    await queue.flush();

    // flush() uses ignoreSchedule: takes PENDING plus expired claims, and the
    // claim SQL always carries the reclaim predicate.
    const sql = String((queryRawUnsafe.mock.calls[0] as unknown[])[0]);
    expect(sql).toMatch('SKIP LOCKED');
    expect(sql).toMatch("status = 'CLAIMED'");
    expect(sql).toMatch('claimed_at');
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
  });
});
