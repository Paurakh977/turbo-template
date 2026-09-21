import { jest } from '@jest/globals';

const evalMock = jest.fn<() => Promise<unknown>>();

jest.mock('../redis/redis.module', () => ({
  REDIS_CLIENT: 'REDIS_CLIENT',
}));

import { ServerActionRateLimitService } from './server-action-rate-limit.service';

describe('ServerActionRateLimitService', () => {
  let service: ServerActionRateLimitService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ServerActionRateLimitService({
      // deno-lint-ignore no-explicit-any
      eval: evalMock as any,
    } as never);
  });

  it('allows hits inside the window with a single Lua round trip', async () => {
    evalMock.mockResolvedValue([3, 59_000]);
    await expect(
      service.check({ scope: 's', identifier: 'u', windowMs: 60_000, max: 5 }),
    ).resolves.toEqual({ allowed: true, retryAfterMs: 0 });
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0][0]).toContain('PTTL');
  });

  it('blocks once the counter exceeds max and reports remaining TTL', async () => {
    evalMock.mockResolvedValueOnce([6, 23_000]); // INCR above max + PTTL
    const decision = await service.check({
      scope: 's',
      identifier: 'u',
      windowMs: 60_000,
      max: 5,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(23_000);
  });

  it('falls back to the full window when the key has no TTL', async () => {
    evalMock.mockResolvedValueOnce([7, -1]);
    const decision = await service.check({
      scope: 's',
      identifier: 'u',
      windowMs: 30_000,
      max: 5,
    });
    expect(decision).toEqual({ allowed: false, retryAfterMs: 30_000 });
  });

  it('treats a nil Lua response as count 0 (fail-open on empty store)', async () => {
    evalMock.mockResolvedValueOnce(null);
    await expect(
      service.check({ scope: 's', identifier: 'u', windowMs: 1000, max: 1 }),
    ).resolves.toEqual({ allowed: true, retryAfterMs: 0 });
  });
});
