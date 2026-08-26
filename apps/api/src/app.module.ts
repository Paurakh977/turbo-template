import {
  Module,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import {
  ThrottlerModule,
  ThrottlerGuard,
} from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from '@repo/auth';
import { db } from '@repo/database';

import { RedisModule } from './redis/redis.module';
import { LinksModule } from './links/links.module';
import { NotesModule } from './notes/notes.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { ServerActionRateLimitModule } from './rate-limit/server-action-rate-limit.module';
import { HealthModule } from './health/health.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

/**
 * Closes the shared pg pool on SIGTERM so docker stop drains connections
 * instead of relying on process kill to reap sockets.
 */
class DatabaseShutdown implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await db.$disconnect().catch(() => undefined);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        HOST: Joi.string().required(),
        PORT: Joi.number().integer().min(1).max(65535).required(),
        DATABASE_URL: Joi.string().uri().required(),
        REDIS_URL: Joi.string().uri().required(),
        NEXT_PUBLIC_APP_URL: Joi.string().uri().required(),
        BETTER_AUTH_URL: Joi.string().uri().required(),
        BETTER_AUTH_SECRET: Joi.string().min(32).required(),
        APP_NAME: Joi.string().required(),
        TRUSTED_ORIGINS: Joi.string().allow('').optional(),
      }).unknown(true), // allow other variables
      validationOptions: { abortEarly: true },
    }),
    RedisModule,
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000,
        limit: 200,
      },
    ]),
    AuthModule.forRoot({
      auth,
      // main.ts owns the single CORS layer (full origin list incl. PATCH).
      // Without this the library auto-registers a SECOND cors middleware from
      // better-auth's trustedOrigins (no PATCH, divergent list), which 500s
      // simple requests whose Origin is allowed by ours but not theirs.
      disableTrustedOriginsCors: true,
      bodyParser: {
        json: { limit: '2mb' },
        urlencoded: { limit: '2mb', extended: true },
      },
    }),
    LinksModule,
    NotesModule,
    AuditModule,
    UsersModule,
    ServerActionRateLimitModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    DatabaseShutdown,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
