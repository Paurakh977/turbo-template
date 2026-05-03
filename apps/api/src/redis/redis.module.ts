import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Retry strategy: exponential back-off, max 30 s
          retryStrategy: (times) => Math.min(times * 200, 30_000),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          keepAlive: 10_000,
        });

        client.on('error', (err) =>
          console.error('[Redis] Connection error:', err),
        );
        client.on('connect', () => console.log('[Redis] Connected'));
        client.on('reconnecting', () => console.warn('[Redis] Reconnecting…'));

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
