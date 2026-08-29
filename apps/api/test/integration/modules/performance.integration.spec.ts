import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('Performance Smoke Tests (integration)', () => {
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

  describe('Concurrent Note Creation', () => {
    it('handles 20 concurrent note creations without data corruption', async () => {
      const email = `perf-create-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'PerfCreator', 'operator');

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          request(app.getHttpServer())
            .post('/api/notes')
            .set('Cookie', signup.cookie!)
            .send({ title: `Concurrent ${i}`, content: `Content ${i}` }),
        ),
      );

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 201,
      );
      expect(successes.length).toBe(20);

      // Verify all notes exist in DB
      const user = await db.user.findUnique({ where: { email } });
      const count = await db.note.count({ where: { authorId: user!.id } });
      expect(count).toBe(20);
    });
  });

  describe('Concurrent Session Lookups', () => {
    it('handles 20 concurrent session lookups', async () => {
      const email = `perf-session-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Perf Session' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          request(app.getHttpServer())
            .get('/api/auth/get-session')
            .set('Cookie', cookie),
        ),
      );

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200,
      );
      expect(successes.length).toBe(20);
    });
  });

  describe('Concurrent Rate Limit Checks', () => {
    it('handles 10 concurrent rate limit increments atomically', async () => {
      const email = `perf-ratelimit-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Perf RateLimit' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          request(app.getHttpServer())
            .post('/api/rate-limit/check')
            .set('Cookie', cookie)
            .send({ scope: 'notes:create-note', windowMs: 60000, max: 5 }),
        ),
      );

      const bodies = results
        .filter((r): r is PromiseFulfilledResult<{ status: number; body: { allowed: boolean; retryAfterMs: number } }> =>
          r.status === 'fulfilled',
        )
        .map((r) => r.value.body);

      // All responses should be consistent (no race conditions)
      const allowed = bodies.filter((b) => b.allowed === true);
      const blocked = bodies.filter((b) => b.allowed === false);
      expect(allowed.length + blocked.length).toBe(10);

      // First 5 should be allowed, rest blocked
      expect(allowed.length).toBe(5);
      expect(blocked.length).toBe(5);
    });
  });

  describe('Health Endpoint Under Load', () => {
    it('handles 50 concurrent health checks', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, () =>
          request(app.getHttpServer()).get('/api/health/live'),
        ),
      );

      const successes = results.filter(
        (r) => r.status === 'fulfilled' && r.value.status === 200,
      );
      expect(successes.length).toBe(50);
    });
  });
});
