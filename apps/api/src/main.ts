import './load-env';
import './otel';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger } from '@repo/observability';
import helmet from 'helmet';
import compression from 'compression';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import {
  MetricsService,
  normalizeRouteForMetrics,
} from './common/observability/metrics.service';

async function bootstrap() {
  const logger = createLogger('api');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // HOST/PORT were already validated at module init by ConfigModule's Joi
  // schema (single validator - the former src/env.ts duplicate is gone).
  const config = app.get(ConfigService);
  const host = config.getOrThrow<string>('HOST');
  const port = config.getOrThrow<number>('PORT');

  // Trust nginx reverse proxy — fixes rate limit IP warning
  app.set('trust proxy', 1);

  const metricsService = app.get(MetricsService);

  // ─── Catch-All HTTP Metrics Middleware ─────────────────────────────────
  // Captures ALL responses including 404s (unmatched routes) and 502s that
  // bypass the NestJS ObservabilityInterceptor. Runs on every request.
  app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const reqPath = String(req.path || req.url || '');
      // Shared normalizer (see metrics.service.ts) — keeps the Prometheus
      // `route` label bounded (one series per template, not per ID).
      const route = normalizeRouteForMetrics(reqPath);
      metricsService.recordHttpRequest(req.method || 'GET', route, res.statusCode, durationMs);
      if (res.statusCode >= 500) {
        metricsService.recordHttpError(req.method || 'GET', route, 'ServerError');
      }
      if (!reqPath.includes('/health/live') && !reqPath.includes('/healthz')) {
        logger.info({
          method: req.method,
          route,
          status: res.statusCode,
          duration_ms: durationMs,
          msg: `${req.method} ${route} ${res.statusCode} in ${durationMs}ms`,
        });
      }
    });
    next();
  });

  // ─── Auth Event Metrics Middleware ──────────────────────────────────────
  // Better Auth routes (/api/auth/*) are mounted as raw Express middleware and
  // bypass NestJS interceptors. We hook into the response finish event here to
  // capture auth_events_total before the response is flushed.
  app.use((req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const path: string = req.path || req.url || '';
    if (!path.includes('/auth/')) {
      return next();
    }
    res.on('finish', () => {
      // recordRateLimitHit normalizes internally, but normalize here too so
      // the `path.includes(...)` routing below and the recorded label agree.
      const status = res.statusCode < 400 ? 'success' : 'failure';
      if (path.includes('/sign-in')) {
        const method = path.includes('google') ? 'google' : path.includes('github') ? 'github' : 'email';
        metricsService.recordAuthEvent('sign_in', status, method);
      } else if (path.includes('/sign-up')) {
        metricsService.recordAuthEvent('sign_up', status, 'email');
      } else if (path.includes('/callback')) {
        const method = path.includes('google') ? 'google' : path.includes('github') ? 'github' : 'oauth';
        metricsService.recordAuthEvent('sign_in', status, method);
      } else if (path.includes('/two-factor')) {
        metricsService.recordAuthEvent('2fa_verify', status, 'totp');
      } else if (path.includes('/reset-password')) {
        metricsService.recordAuthEvent('password_reset', status, 'email');
      }
      if (res.statusCode === 429) {
        metricsService.recordRateLimitHit(path);
      }
    });
    next();
  });

  // Security headers via Helmet — tuned for a JSON API server.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      frameguard: { action: 'deny' },
      noSniff: true,
      strictTransportSecurity:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: false,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    }),
  );

  // Response compression (gzip/br)
  app.use(compression());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const trustedOrigins = Array.from(
    new Set(
      [
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.BETTER_AUTH_URL,
        ...(process.env.TRUSTED_ORIGINS?.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean) ?? []),
        // Localhost conveniences are a dev-only affordance; granting them
        // credentialed CORS in production lets any local listener read API
        // responses on a victim machine.
        ...(process.env.NODE_ENV === 'production'
          ? []
          : ['http://localhost', 'https://localhost', 'http://localhost:3000']),
      ].filter(Boolean),
    ),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || trustedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // Deny without CORS headers (browser blocks the response). Throwing
      // here would surface as an unfiltered 500 outside HttpExceptionFilter.
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'traceparent',
      'tracestate',
      'baggage',
    ],
  });

  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.info(`API running on http://${host}:${port}`);
}

void bootstrap();
