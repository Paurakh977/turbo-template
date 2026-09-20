import {
  OUTBOX_CLAIM_TIMEOUT_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_POLL_BATCH_SIZE,
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_STATUS,
  buildOutboxIdempotencyKey,
  isOutboxClaimExpired,
  outboxRetryDelayMs,
  outboxRowToAuditData,
} from './audit-outbox';

describe('audit-outbox helpers (Phase 8)', () => {
  it('exposes the PENDING -> CLAIMED -> DONE / DLQ status vocabulary', () => {
    expect(OUTBOX_STATUS).toEqual({
      PENDING: 'PENDING',
      CLAIMED: 'CLAIMED',
      DONE: 'DONE',
      DLQ: 'DLQ',
    });
  });

  it('pins poller tuning (250ms poll, batch 50, 30s claim timeout, 5 attempts)', () => {
    expect(OUTBOX_POLL_INTERVAL_MS).toBe(250);
    expect(OUTBOX_POLL_BATCH_SIZE).toBe(50);
    expect(OUTBOX_CLAIM_TIMEOUT_MS).toBe(30_000);
    expect(OUTBOX_MAX_ATTEMPTS).toBe(5);
  });

  it('backs off exponentially across retries', () => {
    const delays = [1, 2, 3, 4, 5, 99].map(outboxRetryDelayMs);
    expect(delays[0]).toBe(1_000);
    expect(delays[1]).toBe(5_000);
    expect(delays[2]).toBe(30_000);
    expect(delays[3]).toBe(120_000);
    // saturates at the tail instead of growing unbounded
    expect(delays[4]).toBe(120_000);
    expect(delays[5]).toBe(120_000);
    for (let i = 1; i < 4; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
  });

  it('builds deterministic keys for natural seeds, unique keys per event otherwise', () => {
    expect(buildOutboxIdempotencyKey('note_created', 'n1')).toBe('note_created:n1');
    expect(buildOutboxIdempotencyKey('note_created', 'n1')).toBe(
      buildOutboxIdempotencyKey('note_created', 'n1'),
    );
    const a = buildOutboxIdempotencyKey('note_updated', 'n1', true);
    const b = buildOutboxIdempotencyKey('note_updated', 'n1', true);
    expect(a).not.toBe(b);
    expect(a.startsWith('note_updated:n1:')).toBe(true);
  });

  it('maps a claimed row to the audit_log payload', () => {
    expect(
      outboxRowToAuditData({
        id: 'o1',
        action: 'note_created',
        userId: 'u1',
        actor: null,
        targetId: null,
        metadata: { noteId: 'n1' },
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      }),
    ).toEqual({
      userId: 'u1',
      action: 'note_created',
      actor: undefined,
      metadata: { noteId: 'n1' },
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
    });
  });

  it('expires claims past the timeout (crash recovery) and never live ones', () => {
    const now = Date.now();
    expect(isOutboxClaimExpired(null, now)).toBe(true);
    expect(
      isOutboxClaimExpired(new Date(now - OUTBOX_CLAIM_TIMEOUT_MS - 1000), now),
    ).toBe(true);
    expect(isOutboxClaimExpired(new Date(now - 1000), now)).toBe(false);
  });
});
