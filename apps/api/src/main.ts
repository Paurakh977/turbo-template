import './load-env';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

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
    ],
  });

  app.enableShutdownHooks();

  await app.listen(port, host);
  logger.log(`API running on http://${host}:${port}`);
}

void bootstrap();
