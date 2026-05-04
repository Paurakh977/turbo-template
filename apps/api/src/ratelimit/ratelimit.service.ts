import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class RateLimitService implements OnModuleInit {
  private readonly logger = new Logger(RateLimitService.name);

  private readonly maxPerWindow: number;
  private readonly windowMs: number;

  private static readonly SLIDING_WINDOW_LUA = `
    local key    = KEYS[1]
    local now    = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit  = tonumber(ARGV[3])
    local cutoff = now - window

    redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

    local count = redis.call('ZCARD', key)

    if count >= limit then
      return 0
    end

    redis.call('ZADD', key, now, now .. '-' .. math.random(1, 1000000))
    redis.call('PEXPIRE', key, window + 10000)

    return 1
  `;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.maxPerWindow = this.configService.get<number>(
      'SST_MAX_KEYS_PER_WINDOW',
      6,
    );
    this.windowMs = this.configService.get<number>('SST_KEY_WINDOW_MS', 60_000);
  }

  onModuleInit() {
    this.logger.log(
      `RateLimitService ready — limit: ${this.maxPerWindow} req / ${this.windowMs}ms [Redis-backed]`,
    );
  }

  async check(identifier: string, prefix = 'sst'): Promise<boolean> {
    const key = `${prefix}:${identifier}`;
    const now = Date.now();

    try {
      const result = (await (this.redis as any).eval(
        RateLimitService.SLIDING_WINDOW_LUA,
        1,
        key,
        now,
        this.windowMs,
        this.maxPerWindow,
      )) as number;

      return result === 1;
    } catch (err) {
      this.logger.error(
        `Redis rate-limit check failed for key="${key}": ${(err as Error).message}`,
        (err as Error).stack,
      );
      return true;
    }
  }
}
