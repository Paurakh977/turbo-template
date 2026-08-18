import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';

import { AppModule } from './app.module';
import { getApiEnv } from './env';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const { host, port } = getApiEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

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

  app.setGlobalPrefix('api', {
    exclude: ['auth/(.*)'], // Match the behavior from old main.ts
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const trustedOrigins = Array.from(
    new Set(
      [
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.BETTER_AUTH_URL,
        ...(process.env.TRUSTED_ORIGINS?.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean) ?? []),
        'http://localhost',
        'https://localhost',
        'http://localhost:3000',
      ].filter(Boolean),
    ),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || trustedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin "${origin}" is not allowed.`));
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
