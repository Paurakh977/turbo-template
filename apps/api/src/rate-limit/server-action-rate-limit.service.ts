import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
};

/**
 * Atomic fixed-window rate limiter on Redis.
 *
 * The Lua script performs INCR + EXPIRE-on-first-create in ONE round trip so
 * the window starts at the first hit and later increments never extend it -
 * identical contract to Better Auth's SecondaryStorage.increment and to the
 * DB-backed limiter this replaces (web's server-action-rate-limit.ts).
 *
 * Errors propagate to the caller so it can decide fail-open vs fail-closed.
 */
@Injectable()
export class ServerActionRateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async check(input: {
    scope: string;
    identifier: string;
    windowMs: number;
    max: number;
  }): Promise<RateLimitDecision> {
    const key = `server-action:${input.scope}:${input.identifier}`;
    const windowSeconds = Math.max(1, Math.ceil(input.windowMs / 1000));

    const result = await this.redis.eval(
      "local v = redis.call('INCR', KEYS[1]) if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return v",
      1,
      key,
      String(windowSeconds),
    );

    const count = Number(result) || 0;

    if (count > input.max) {
      const ttlSeconds = await this.redis.ttl(key);
      const retryAfterMs = ttlSeconds > 0 ? ttlSeconds * 1000 : input.windowMs;
      return { allowed: false, retryAfterMs: Math.max(1000, retryAfterMs) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}
