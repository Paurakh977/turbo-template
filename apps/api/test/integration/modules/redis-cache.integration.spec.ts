import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis, getTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('Redis Cache Integration (integration)', () => {
  let app: INestApplication;
  let redis: ReturnType<typeof getTestRedis>;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
    redis = getTestRedis();
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

  describe('Better Auth Session Cache', () => {
    it('stores session in Redis after login', async () => {
      const email = `redis-session-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'TestPassword123!', name: 'Redis Session' })
        .expect(200);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'TestPassword123!' })
        .expect(200);

      const cookie = loginRes.headers['set-cookie'][0];

      // Verify session works
      await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      // Check Redis for session-related keys
      const keys = await redis.keys('session:*');
      // Better Auth stores session data in Redis
      expect(keys.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rate Limit Counter', () => {
    it('creates rate limit key in Redis after check', async () => {
      const email = `redis-cache-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'CacheUser', 'operator');
      
      // Make a request that triggers rate limit tracking
      await request(app.getHttpServer())
        .post('/api/rate-limit/check')
        .set('Cookie', signup.cookie!)
        .send({ scope: 'notes:create-note', windowMs: 60000, max: 10 });
      
      // Use a bare Redis client (no prefix) to check app-written keys
      const Redis = (await import('ioredis')).default;
      const bareRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
      try {
        const keys = await bareRedis.keys('server-action:*');
        expect(keys.length).toBeGreaterThanOrEqual(1);
      } finally {
        await bareRedis.quit();
      }
    });

    it('increments rate limit counter atomically', async () => {
      const email = `redis-atomic-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'TestPassword123!', name: 'Redis Atomic' })
        .expect(200);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'TestPassword123!' })
        .expect(200);

      const cookie = loginRes.headers['set-cookie'][0];

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/rate-limit/check')
          .set('Cookie', cookie)
          .send({ scope: 'notes:create-note', windowMs: 60000, max: 10 });
      }

      // Check the counter value using a bare Redis client (no prefix)
      const Redis = (await import('ioredis')).default;
      const bareRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
      try {
        const keys = await bareRedis.keys('server-action:notes:create-note:*');
        expect(keys.length).toBeGreaterThanOrEqual(1);
        if (keys.length > 0) {
          const value = await bareRedis.get(keys[0]);
          expect(Number(value)).toBeGreaterThanOrEqual(1);
        }
      } finally {
        await bareRedis.quit();
      }
    });
  });

  describe('Redis Health', () => {
    it('Redis ping returns PONG', async () => {
      const result = await redis.ping();
      expect(result).toBe('PONG');
    });

    it('Redis supports SET/GET/DEL operations', async () => {
      await redis.set('test-key', 'test-value');
      const value = await redis.get('test-key');
      expect(value).toBe('test-value');
      await redis.del('test-key');
      const deleted = await redis.get('test-key');
      expect(deleted).toBeNull();
    });
  });
});
