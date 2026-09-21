import type Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { createLogger, getMeter } from '@repo/observability';
import type { Counter } from '@opentelemetry/api';

/**
 * Structural copy of throttler's `ThrottlerStorageRecord` (the lib re-export
 * omits it from the package index; importing the deep dist path would couple
 * us to internal layout). Assignability to the interface is checked by
 * `implements ThrottlerStorage` below.
 */
type ThrottlerRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

/**
 * Redis-backed Nest throttler storage.
 *
 * Why: the default in-memory storage counts per API replica, so N replicas
 * silently multiply the 200/min global budget by N. This delegates to the
 * official `@nest-lab/throttler-storage-redis` service (atomic Lua
 * INCR+EXPIRE, shared counters) built on the EXISTING shared `REDIS_CLIENT`
 * singleton — no second connection, no new env vars.
 *
 * Key shape (library-owned, verified disjoint): `{<tracker>:<name>}:hits`
 * and `:blocked` hash-tagged keys. No collision with Better Auth's bare
 * session tokens, `server-action:*`, `verification:*`, or `pending_*`.
 * Nothing here touches Better Auth rate limiting (different counters,
 * different keys) or nginx zones (different layer) — see the rate-limit
 * layer table in the audit trail / plan doc.
 *
 * Outage posture — fail OPEN to per-instance memory: the guard has no
 * try/catch around `storage.increment` (verified in throttler.guard.js), so
 * a bare Redis storage would 500 EVERY request during a Redis blip — worse
 * than the pre-change memory behavior and incoherent with the session layer,
 * which fails open (secondaryStorage returns null → PG fallback), and with
 * Better Auth's `increment` (returns 0 → allow). On Redis error we log and
 * count in a bounded in-memory fixed window instead: protection degrades to
 * per-instance (exactly the old behavior) rather than availability dropping
 * to zero. Alert on the warn log, not on 500s.
 */
const MEMORY_FALLBACK_MAX_KEYS = 5000;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = createLogger('api.throttler');
  private readonly redisStorage: ThrottlerStorageRedisService;
  private readonly memoryFallback = new Map<
    string,
    { hits: number; expiresAt: number }
  >();
  private readonly redisErrorsTotal: Counter;
  private readonly fallbackTotal: Counter;

  constructor(redis: Redis) {
    // Existing client instance → `disconnectRequired` stays unset, so the
    // library never quits our shared connection on module destroy.
    this.redisStorage = new ThrottlerStorageRedisService(redis);

    // Metrics registered at construction time so they are always available
    // regardless of NestJS DI lifecycle. The meter is process-global and
    // idempotent — double-registration is safe.
    const meter = getMeter('api');
    this.redisErrorsTotal = meter.createCounter('throttler_redis_errors_total', {
      description: 'Total number of Redis errors in the throttler storage layer',
    });
    this.fallbackTotal = meter.createCounter('throttler_fallback_total', {
      description:
        'Total number of times the throttler fell back to per-instance memory',
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    try {
      return await this.redisStorage.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (error) {
      this.logger.warn(
        { err: error, throttlerName },
        'Throttler Redis unavailable, failing open to per-instance memory window',
      );
      this.redisErrorsTotal.add(1, { throttler_name: throttlerName });
      this.fallbackTotal.add(1, { throttler_name: throttlerName });
      return this.memoryIncrement(key, ttl);
    }
  }

  /**
   * Fixed-window counter, fail-open variant: never reports blocked (matches
   * the pre-change posture under outage — permissive, never a 500). Bounded
   * so a long outage can't grow memory without limit.
   */
  private memoryIncrement(key: string, ttl: number): ThrottlerRecord {
    if (this.memoryFallback.size >= MEMORY_FALLBACK_MAX_KEYS) {
      const now = Date.now();
      for (const [k, v] of this.memoryFallback) {
        if (v.expiresAt <= now) this.memoryFallback.delete(k);
      }
    }
    const now = Date.now();
    const entry = this.memoryFallback.get(key);
    if (!entry || entry.expiresAt <= now) {
      this.memoryFallback.set(key, { hits: 1, expiresAt: now + ttl });
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }
    entry.hits += 1;
    return {
      totalHits: entry.hits,
      timeToExpire: Math.max(0, entry.expiresAt - now),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
