import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from '../../../src/app.module';
import { HttpExceptionFilter } from '../../../src/common/http-exception.filter';
import { DummyOAuthController } from './dummy-oauth.controller';

const SHARED_APP_KEY = Symbol.for('integration-test-shared-app');

/**
 * Creates a fully bootstrapped NestJS application with real DI,
 * real database, real Redis, real Better Auth — no mocks.
 *
 * The app is bootstrapped ONCE per test run and reused across every
 * suite (which run sequentially under maxWorkers: 1). This avoids paying
 * the full ~30s bootstrap cost in each suite's beforeAll.
 *
 * Caller MUST call app.close() in afterAll. Because the instance is
 * shared between suites, close() is a no-op; the process is torn down
 * by Jest's --forceExit.
 */
export async function createTestApp(): Promise<INestApplication> {
  const globalRef = globalThis as unknown as Record<symbol, INestApplication | undefined>;
  const cached = globalRef[SHARED_APP_KEY];
  if (cached) {
    return cached;
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [DummyOAuthController],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Mirror main.ts configuration exactly
  app.set('trust proxy', 1);

  // Security headers via Helmet — same config as production
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      frameguard: { action: 'deny' },
      noSniff: true,
      strictTransportSecurity: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: false,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    }),
  );

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

  // CORS — mirror main.ts trusted origins logic
  const config = app.get(ConfigService);
  const trustedOrigins = Array.from(
    new Set(
      [
        config.get('NEXT_PUBLIC_APP_URL'),
        config.get('BETTER_AUTH_URL'),
        ...(config.get('TRUSTED_ORIGINS')?.split(',')
          .map((o: string) => o.trim())
          .filter(Boolean) ?? []),
        'http://localhost',
        'https://localhost',
        'http://localhost:3000',
      ].filter(Boolean),
    ),
  );

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || trustedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // The dummy OAuth provider (enabled only under the oauth config) makes
  // loopback HTTP calls back into this same app's /api/dummy/* endpoints, which
  // requires the server to actually be listening on a known port. Only the
  // oauth config enables this; every other suite keeps the server unbound
  // (app.init) so multiple isolated test files don't fight over port 3001.
  if (process.env.OAUTH_TEST_PROVIDER === '1') {
    await app.listen(3001, '127.0.0.1');
  } else {
    await app.init();
  }

  // Shared instance: make close() a no-op so a suite's afterAll doesn't
  // tear down the server other suites still depend on. Cleanup happens
  // via Jest's --forceExit.
  (app as unknown as { close: () => Promise<void> }).close = async () => {};

  globalRef[SHARED_APP_KEY] = app;
  return app;
}
