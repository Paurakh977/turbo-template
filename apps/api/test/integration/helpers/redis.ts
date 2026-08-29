import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PREFIX = process.env.REDIS_PREFIX || 'int-test:';

let sharedClient: Redis | null = null;

/**
 * Returns a Redis client connected to the test instance.
 * Reuses a single connection across all helpers.
 */
export function getTestRedis(): Redis {
  if (!sharedClient) {
    sharedClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      keyPrefix: PREFIX,
    });
  }
  return sharedClient;
}

/**
 * Returns the Redis key prefix used in tests.
 */
export function getPrefix(): string {
  return PREFIX;
}

/**
 * Flushes all keys matching the test prefix using SCAN (safe for production).
 * Also flushes unprefixed keys used by Better Auth (rate-limit, sessions, etc.)
 */
export async function clearTestRedis() {
  // Clear Better Auth's unprefixed keys (rate-limit, session cache, etc.)
  const bareRedis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  await bareRedis.flushdb();
  await bareRedis.quit();

  // Clear test-prefixed keys as well
  const redis = getTestRedis();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${PREFIX}*`,
      'COUNT',
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      const bareKeys = keys.map((k) => k.replace(PREFIX, ''));
      await redis.del(...bareKeys);
    }
  } while (cursor !== '0');
}

/**
 * Waits for a key to appear in Redis (with timeout).
 */
export async function waitForKey(
  pattern: string,
  timeoutMs = 5000,
): Promise<string | null> {
  const redis = getTestRedis();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const keys = await redis.keys(`${PREFIX}${pattern}`);
    if (keys.length > 0) return keys[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

/**
 * Disconnects the shared Redis client (call in afterAll).
 */
export async function disconnectTestRedis() {
  if (sharedClient) {
    await sharedClient.quit();
    sharedClient = null;
  }
}
