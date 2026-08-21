import Redis from 'ioredis';
import { redisUrl } from './env';

type GlobalRedisState = typeof globalThis & {
  __repoSharedRedisClient?: Redis;
};

/**
 * Shared Redis client.
 *
 * A module-level singleton cached on `globalThis` so hot-reloads (dev) and
 * multiple module copies never create duplicate connections. All Redis ops
 * are handled by callers with explicit error handling — this module never
 * throws on connection failure.
 */
export const redis = (() => {
  if (!redisUrl) return null;
  const globalRedisState = globalThis as GlobalRedisState;
  if (globalRedisState.__repoSharedRedisClient) {
    return globalRedisState.__repoSharedRedisClient;
  }

  const client = new Redis(redisUrl, {
    retryStrategy: (times) => Math.min(times * 200, 30_000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    keepAlive: 10_000,
  });

  // Swallow connection errors so a Redis outage never crashes the process
  // with an unhandled 'error' event. Every caller already handles failures
  // gracefully (falls back to primary storage / in-memory stashes).
  client.on('error', (error) => {
    console.error('[Redis Error] Connection error:', error);
  });

  globalRedisState.__repoSharedRedisClient = client;
  return client;
})();