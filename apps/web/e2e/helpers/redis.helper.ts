import { Redis } from 'ioredis';
import { E2E } from '../config/playwright.env';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(E2E.redisURL, { maxRetriesPerRequest: 3 });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export async function flushAll(): Promise<void> {
  await getRedis().flushall();
}

/**
 * Delete only rate-limit counter keys so active sessions stay alive.
 * Better Auth stores sessions in Redis secondary storage — flushall() would
 * destroy those sessions and break authenticated test fixtures.
 *
 * Rate-limit keys match patterns:
 *   - "ratelimit:*"                     (Better Auth built-in prefix)
 *   - "better-auth:rate-limit*"         (older prefix)
 *   - "{ip}|{path}"  e.g. "127.0.0.1|/sign-in/email"
 */
export async function flushRateLimits(): Promise<void> {
  try {
    const redis = getRedis();
    const patterns = ['ratelimit:*', 'better-auth:rate-limit*', '*|/*'];
    const toDelete: string[] = [];
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      toDelete.push(...keys);
    }
    if (toDelete.length > 0) {
      await redis.del(...toDelete);
    }
  } catch {
    /* ignore */
  }
}

export async function keysLike(pattern: string): Promise<string[]> {
  return getRedis().keys(pattern);
}

export async function ttl(key: string): Promise<number> {
  return getRedis().ttl(key);
}

/**
 * Wait until a redis key exists (or timeout). Useful for asserting that an
 * action actually wrote to the cache (e.g. rate-limit counter, session).
 */
export async function waitForKey(
  pattern: string,
  timeoutMs = 5000,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await keysLike(pattern);
    if (found.length > 0) return found[0] ?? null;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
