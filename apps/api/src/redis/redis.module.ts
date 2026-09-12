import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createLogger } from '@repo/observability';

export const REDIS_CLIENT = 'REDIS_CLIENT';

type GlobalRedisState = typeof globalThis & {
  __repoSharedRedisClient?: Redis;
};

const logger = createLogger('redis');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const globalRedisState = globalThis as GlobalRedisState;
        if (globalRedisState.__repoSharedRedisClient) {
          return globalRedisState.__repoSharedRedisClient;
        }

        const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Retry strategy: exponential back-off, max 30 s
          retryStrategy: (times) => Math.min(times * 200, 30_000),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          keepAlive: 10_000,
        });

        client.on('error', (err) =>
          logger.error({ err, msg: '[Redis] Connection error' }),
        );
        client.on('connect', () => logger.info('[Redis] Connected'));
        client.on('reconnecting', () => logger.warn('[Redis] Reconnecting…'));
        client.on('end', () => logger.info('[Redis] Connection closed'));

        globalRedisState.__repoSharedRedisClient = client;
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
