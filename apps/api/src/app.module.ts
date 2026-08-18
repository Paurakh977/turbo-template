import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from '@repo/auth';

import { RedisModule } from './redis/redis.module';
import { RatelimitModule } from './ratelimit/ratelimit.module';
import { LinksModule } from './links/links.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        HOST: Joi.string().required(),
        PORT: Joi.number().required(),
        DATABASE_URL: Joi.string().uri().required(),
        REDIS_URL: Joi.string().uri().required(),
        NEXT_PUBLIC_APP_URL: Joi.string().uri().required(),
        BETTER_AUTH_URL: Joi.string().uri().required(),
        BETTER_AUTH_SECRET: Joi.string().min(32).required(),
        APP_NAME: Joi.string().required(),
        TRUSTED_ORIGINS: Joi.string().allow('').optional(),
        SST_MAX_KEYS_PER_WINDOW: Joi.number().integer().min(1).default(6),
        SST_KEY_WINDOW_MS: Joi.number().integer().min(1000).default(60_000),
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
      bodyParser: {
        json: { limit: '2mb' },
        urlencoded: { limit: '2mb', extended: true },
      },
    }),
    LinksModule,
    RatelimitModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
