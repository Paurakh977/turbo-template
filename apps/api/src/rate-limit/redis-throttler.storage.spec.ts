import { jest } from '@jest/globals';

// Behavior stash consulted at CALL time (after the spec body ran), so the
// hoisted mock factory can close over it. `jest.fn` classes are not
// `new`-able, hence the function-style mockImplementation.
const mockRedisBehavior = {
  impl: async (..._args: unknown[]): Promise<unknown> => {
    throw new Error('stub mockRedisBehavior.impl per test');
  },
};

// Shared counter stubs so we can assert .add() calls from any test.
const mockRedisErrorCounter = { add: jest.fn() };
const mockFallbackCounter = { add: jest.fn() };

jest.mock('@nest-lab/throttler-storage-redis', () => ({
  ThrottlerStorageRedisService: jest.fn().mockImplementation(function (
    this: { increment: unknown },
  ) {
    this.increment = (...args: unknown[]) => mockRedisBehavior.impl(...args);
  }),
}));

jest.mock('@repo/observability', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  getMeter: jest.fn(() => ({
    createCounter: jest.fn((name: string) => {
      if (name === 'throttler_redis_errors_total') return mockRedisErrorCounter;
      if (name === 'throttler_fallback_total') return mockFallbackCounter;
      return { add: jest.fn() };
    }),
    createHistogram: jest.fn(() => ({ record: jest.fn() })),
    createGauge: jest.fn(() => ({ record: jest.fn() })),
    createObservableGauge: jest.fn(() => ({ addCallback: jest.fn() })),
  })),
}));

import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const seenArgs: unknown[][] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisErrorCounter.add.mockClear();
    mockFallbackCounter.add.mockClear();
    seenArgs.length = 0;
  });

  function makeStorage() {
    // Redis client is only forwarded to the (mocked) library constructor.
    return new RedisThrottlerStorage({} as never);
  }

  it('delegates to Redis and returns its record untouched', async () => {
    const record = {
      totalHits: 7,
      timeToExpire: 59000,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
    mockRedisBehavior.impl = async (...args: unknown[]) => {
      seenArgs.push(args);
      return record;
    };

    const storage = makeStorage();
    await expect(
      storage.increment('ip-1', 60000, 200, 0, 'global'),
    ).resolves.toEqual(record);
    expect(seenArgs).toEqual([['ip-1', 60000, 200, 0, 'global']]);
  });

  it('fails open to the memory window when Redis throws (never rejects)', async () => {
    mockRedisBehavior.impl = async () => {
      throw new Error('ECONNREFUSED');
    };

    const storage = makeStorage();
    const first = await storage.increment('ip-1', 60000, 200, 0, 'global');
    const second = await storage.increment('ip-1', 60000, 200, 0, 'global');

    expect(first.isBlocked).toBe(false);
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.timeToExpire).toBeGreaterThan(0);
    expect(second.timeToExpire).toBeLessThanOrEqual(60000);
  });

  it('increments redis error and fallback counters on Redis failure', async () => {
    mockRedisBehavior.impl = async () => {
      throw new Error('ECONNREFUSED');
    };

    const storage = makeStorage();
    await storage.increment('ip-1', 60000, 200, 0, 'global');

    // Both counters must be incremented exactly once per fallback event.
    expect(mockRedisErrorCounter.add).toHaveBeenCalledTimes(1);
    expect(mockRedisErrorCounter.add).toHaveBeenCalledWith(1, {
      throttler_name: 'global',
    });
    expect(mockFallbackCounter.add).toHaveBeenCalledTimes(1);
    expect(mockFallbackCounter.add).toHaveBeenCalledWith(1, {
      throttler_name: 'global',
    });
  });
});
