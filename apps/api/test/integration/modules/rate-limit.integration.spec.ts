import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('ServerActionRateLimitModule (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await clearTestRedis();
    await seedBaseUsers();
  });

  describe('POST /api/rate-limit/check', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .send({ scope: 'notes:create-note', windowMs: 60000, max: 10 })
        .expect(401);
    });

    it('allows first request within limit', async () => {
      const email = `ratelimit-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateLimiter', 'operator');

      const res = await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:create-note', windowMs: 60000, max: 10 })
        .expect([200, 201]);

      expect(res.body.allowed).toBe(true);
      expect(res.body.retryAfterMs).toBe(0);
    });

    it('blocks after exceeding max', async () => {
      const email = `ratelimit-max-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateMax', 'operator');

      // Exhaust the limit (max: 3)
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/rate-limit/check')
          .set('Cookie', signup.cookie!)
          .send({ scope: 'notes:create-note', windowMs: 60000, max: 3 })
          .expect([200, 201]);
      }

      // 4th request should be blocked
      const res = await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:create-note', windowMs: 60000, max: 3 })
        .expect([200, 201]);

      expect(res.body.allowed).toBe(false);
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
    });

    it('different scopes are independent', async () => {
      const email = `ratelimit-scope-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateScope', 'operator');

      // Exhaust one scope
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/rate-limit/check')
          .set('Cookie', signup.cookie!)
          .send({ scope: 'notes:create-note', windowMs: 60000, max: 3 });
      }

      // Different scope should still be allowed
      const res = await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:update-note', windowMs: 60000, max: 3 })
        .expect([200, 201]);

      expect(res.body.allowed).toBe(true);
    });

    it('rejects invalid scope', async () => {
      const email = `ratelimit-invalid-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateInvalid', 'operator');

      await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'invalid:scope', windowMs: 60000, max: 10 })
        .expect(400);
    });

    it('rejects windowMs below minimum', async () => {
      const email = `ratelimit-window-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateWindow', 'operator');

      await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:create-note', windowMs: 500, max: 10 })
        .expect(400);
    });

    it('rejects max above maximum', async () => {
      const email = `ratelimit-maxval-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RateMaxVal', 'operator');

      await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:create-note', windowMs: 60000, max: 2000 })
        .expect(400);
    });
  });
});
