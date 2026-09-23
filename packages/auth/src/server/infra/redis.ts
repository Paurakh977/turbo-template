import Redis from 'ioredis';
import { createLogger, getMeter } from '@repo/observability';
import { redisUrl } from '../../config/env';

type GlobalRedisState = typeof globalThis & {
  __repoSharedRedisClient?: Redis;
};

const logger = createLogger('auth:redis');

const meter = getMeter('redis');
const redisErrorsTotal = meter.createCounter('redis_errors_total', {
  description: 'Total number of Redis client errors',
});
const redisReconnectTotal = meter.createCounter('redis_reconnect_total', {
  description: 'Total number of Redis client reconnect attempts',
});
const redisConnectedGauge = meter.createGauge('redis_connected', {
  description: 'Whether Redis client is connected (1 or 0)',
  unit: '{status}',
});

/**
 * Shared Redis client.
 *
 * A module-level singleton cached on `globalThis` so hot-reloads (dev) and
 * multiple module copies never create duplicate connections. All Redis ops
 * are handled by callers with explicit error handling — this module never
 * throws on connection failure.
 */
export const redis = (() => {
  if (!redisUrl) {
    redisConnectedGauge.record(0);
    return null;
  }
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
    redisErrorsTotal.add(1);
    redisConnectedGauge.record(0);
    logger.error({ err: error, msg: '[Redis Error] Connection error' });
  });

  client.on('connect', () => {
    redisConnectedGauge.record(1);
  });

  client.on('ready', () => {
    redisConnectedGauge.record(1);
  });

  client.on('reconnecting', () => {
    redisReconnectTotal.add(1);
    redisConnectedGauge.record(0);
  });

  client.on('close', () => {
    redisConnectedGauge.record(0);
  });

  client.on('end', () => {
    redisConnectedGauge.record(0);
  });

  globalRedisState.__repoSharedRedisClient = client;
  return client;
})();