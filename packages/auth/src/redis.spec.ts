jest.mock('ioredis', () => {
  const mockRedis = jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    getdel: jest.fn().mockResolvedValue(null),
    eval: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(60),
    ping: jest.fn().mockResolvedValue('PONG'),
    on: jest.fn(),
  }));
  return { __esModule: true, default: mockRedis };
});

jest.mock('./env', () => ({
  get redisUrl() {
    return process.env.REDIS_URL ?? null;
  },
}));

describe('redis', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear the global singleton
    const g = globalThis as typeof globalThis & {
      __repoSharedRedisClient?: unknown;
    };
    delete g.__repoSharedRedisClient;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns null when REDIS_URL is not set', () => {
    delete process.env.REDIS_URL;
    const { redis } = require('./redis');
    expect(redis).toBeNull();
  });

  it('creates a Redis client when REDIS_URL is set', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { redis } = require('./redis');
    expect(redis).not.toBeNull();
    expect(redis).toBeDefined();
  });

  it('returns the same singleton instance', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { redis: r1 } = require('./redis');
    const { redis: r2 } = require('./redis');
    expect(r1).toBe(r2);
  });
});
