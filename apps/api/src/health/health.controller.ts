import { Controller, Get, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type Redis from 'ioredis';
import { db } from '@repo/database';

import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Readiness probe: reports READY only when every backing store the request
 * path depends on is actually serving - notably the Redis secondary-storage
 * that holds Better Auth sessions.
 *
 * IMPORTANT: the docker HEALTHCHECK must NOT use this endpoint. A strict
 * readiness gate makes the container flip `unhealthy` whenever Redis/Postgres
 * are still warming up (or blip), and busybox `wget` exits non-zero on any
 * 5xx - so every `depends_on: service_healthy` consumer (web, proxy) would
 * never start. The docker HEALTHCHECK hits `/api/health/live` instead. If you
 * want to keep clients out until the API is truly ready, do it at the nginx
 * layer with `health_check uri=/api/health/ready;` on the api upstream.
 */
@Controller('health')
// The global Better Auth AuthGuard (registered by AuthModule.forRoot) 401s any
// route without @AllowAnonymous. The docker HEALTHCHECK hits these endpoints, so
// they MUST be anonymous - otherwise the container is marked unhealthy and
// every `depends_on: service_healthy` consumer (web, proxy) never starts.
@AllowAnonymous()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Liveness probe: the process is up and serving. This is what the docker
   * HEALTHCHECK should hit - it MUST NOT depend on Redis/Postgres, otherwise a
   * transient warm-up (or a Redis blip) marks the whole container unhealthy
   * and every `depends_on: service_healthy` consumer (web, proxy) never
   * starts.
   */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};

    // Cleared + unref'd: an uncleared probe timer kept the event loop hot for
    // the full window after every success and delayed graceful shutdown.
    let redisTimeout: NodeJS.Timeout | undefined;
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => {
          redisTimeout = setTimeout(() => reject(new Error('timeout')), 1500);
          redisTimeout.unref();
        }),
      ]);
      checks.redis = pong === 'PONG' ? 'ok' : 'unexpected';
    } catch (error) {
      // Redacted: this endpoint is public, never echo driver errors outward.
      this.logger.error(
        `Readiness check failed (redis): ${String(error)}`,
      );
      checks.redis = 'error';
    } finally {
      clearTimeout(redisTimeout);
    }

    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (error) {
      this.logger.error(
        `Readiness check failed (database): ${String(error)}`,
      );
      checks.database = 'error';
    }

    const failed = Object.entries(checks).filter(([, v]) => !v.startsWith('ok'));
    if (failed.length > 0) {
      throw new ServiceUnavailableException({ checks });
    }
    return { status: 'ready', checks };
  }
}
