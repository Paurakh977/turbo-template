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
import { ObservabilityModule } from './common/observability/observability.module';
import { LinksModule } from './links/links.module';
import { NotesModule } from './notes/notes.module';
import { AuditModule } from './audit/audit.module';
import { UsersModule } from './users/users.module';
import { ServerActionRateLimitModule } from './rate-limit/server-action-rate-limit.module';
import { HealthModule } from './health/health.module';

import { AppService } from './app.service';
import { AppController } from './app.controller';

/**
 * Validated integer env parsing for the NestJS throttler.
 * Compose injects tuning knobs as EMPTY strings when unset (`${VAR:-}`), so
 * `Number(process.env.VAR ?? fallback)` misfires: `??` doesn't trigger on
 * `""` and `Number("") === 0`, silently configuring ttl:0/limit:0.
 * Mirrors `parseIntEnv` in packages/auth/src/env.ts (digits-only, min, throw).
 */
function parseThrottleInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${name}: "${raw}" must be a whole number >= 1.`);
  }
  const value = Number(raw);
  if (value < 1) {
    throw new Error(`Invalid ${name}: "${raw}" must be a whole number >= 1.`);
  }
  return value;
}

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
        // ── Observability (single validator — mirrors apps/api/src/otel.ts) ──
        // e2e/test profiles set OTEL_SDK_DISABLED=true and inject no
        // collectors; the SDK stays a fail-open no-op there, so every key
        // below is optional in that case and required otherwise. Keeping this
        // in Joi (instead of only otel.ts requireEnv) fails fast with ONE
        // structured error listing every missing key, before any import
        // side-effect runs.
        OTEL_SDK_DISABLED: Joi.string().valid('true', 'false').optional(),
        OTEL_EXPORTER_OTLP_ENDPOINT: Joi.when('OTEL_SDK_DISABLED', {
          is: 'true',
          then: Joi.string().uri().optional(),
          otherwise: Joi.string().uri().required(),
        }),
        OTEL_SERVICE_NAMESPACE: Joi.when('OTEL_SDK_DISABLED', {
          is: 'true',
          then: Joi.string().optional(),
          otherwise: Joi.string().min(1).required(),
        }),
        // Version: compose maps GIT_SHA into OTEL_SERVICE_VERSION for
        // containers; either key satisfies host runs (see otel.ts fallback).
        // Required when enabled unless GIT_SHA is set (nested when — Joi
        // conditions reference a single sibling key each).
        OTEL_SERVICE_VERSION: Joi.when('OTEL_SDK_DISABLED', {
          is: 'true',
          then: Joi.string().min(1).optional(),
          otherwise: Joi.when('GIT_SHA', {
            // NOTE: `.required()` inside `is` is load-bearing — every Joi
            // schema allows `undefined` by default, so a bare
            // `Joi.string().min(1)` would ALSO match an absent GIT_SHA and
            // wrongly take the `then` branch.
            is: Joi.string().min(1).required(),
            then: Joi.string().min(1).optional(),
            otherwise: Joi.string().min(1).required(),
          }),
        }),
        GIT_SHA: Joi.string().min(1).optional(),
        // Tier name: compose maps OTEL_SERVICE_NAME_API/_WEB into the shared
        // OTEL_SERVICE_NAME per container, so the shared key is always set.
        OTEL_SERVICE_NAME: Joi.when('OTEL_SDK_DISABLED', {
          is: 'true',
          then: Joi.string().optional(),
          otherwise: Joi.string().min(1).required(),
        }),
        OTEL_SERVICE_NAME_API: Joi.string().min(1).optional(),
        OTEL_ENVIRONMENT: Joi.when('OTEL_SDK_DISABLED', {
          is: 'true',
          then: Joi.string().optional(),
          otherwise: Joi.string().min(1).required(),
        }),
        // Profiler is code-optional (otel.ts skips silently when unset), but
        // a half-configured profiler is a bug: app name required iff address
        // set. Empty string counts as unset (compose `${VAR:-}` sends "").
        PYROSCOPE_SERVER_ADDRESS: Joi.string().uri().allow('').optional(),
        PYROSCOPE_APPLICATION_NAME: Joi.when('PYROSCOPE_SERVER_ADDRESS', {
          // NOTE: `.required()` inside `is` is load-bearing — without it an
          // absent address matches (Joi allows undefined by default) and the
          // app name would be wrongly required in e2e/test profiles.
          is: Joi.string().min(1).required(),
          then: Joi.string().min(1).required(),
          otherwise: Joi.string().optional(),
        }),
        // NOTE: OTEL_LOG_LEVEL intentionally unvalidated — logging.ts falls
        // back to info (prod) / debug (dev) when unset.
      }).unknown(true), // allow other variables
      // false (was true): one boot lists EVERY missing key instead of forcing
      // fix-one-reboot-fix-next cycles through docker restarts.
      validationOptions: { abortEarly: false },
    }),
    RedisModule,
    ObservabilityModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: 'global',
          // Configurable via env vars for load-testing scenarios where all
          // VUs share one IP (127.0.0.1). Defaults are production-safe.
          // NOTE: must use parseThrottleInt, not Number(?? fallback) —
          // Compose sends "" when unset and Number("") === 0.
          ttl: parseThrottleInt('THROTTLE_TTL_MS', 60_000),
          limit: parseThrottleInt('THROTTLE_LIMIT', 200),
        },
      ],
    }),
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
