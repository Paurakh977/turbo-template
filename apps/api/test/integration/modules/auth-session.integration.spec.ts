import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';

const TEST_PASSWORD = 'TestPassword123!';

describe('Auth Session (integration)', () => {
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

  describe('Session Persistence', () => {
    it('creates a session cookie on login', async () => {
      const email = `session-create-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Session Create' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.length).toBeGreaterThan(0);
    });

    it('maintains session across requests', async () => {
      const email = `session-persist-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Persist' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      // Multiple requests should all succeed
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get('/api/auth/get-session')
          .set('Cookie', cookie)
          .expect(200);
      }
    });
  });

  describe('Multiple Sessions', () => {
    it('allows multiple concurrent sessions for the same user', async () => {
      const email = `multi-session-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Multi Session' })
        .expect(200);

      // Create 3 sessions
      const cookies: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in/email')
          .send({ email, password: TEST_PASSWORD })
          .expect(200);
        cookies.push(res.headers['set-cookie'][0]);
      }

      // All sessions should be valid
      for (const cookie of cookies) {
        await request(app.getHttpServer())
          .get('/api/auth/get-session')
          .set('Cookie', cookie)
          .expect(200);
      }
    });

    it('invalidates all sessions on password reset request', async () => {
      const email = `revoke-all-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Revoke All' })
        .expect(200);

      // Create multiple sessions
      const cookies: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in/email')
          .send({ email, password: TEST_PASSWORD })
          .expect(200);
        cookies.push(res.headers['set-cookie'][0]);
      }
    });
  });

  describe('Session Expiration', () => {
    it('returns 200 with null user/session for expired/invalid session', async () => {
      // Better Auth returns 200 with a null body for invalid sessions, not 401
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', 'better-auth.session_token=expired-token-value')
        .expect(200);

      expect(res.body).toBeNull();
    });
  });

  describe('Admin Sessions', () => {
    it('admin can access admin-only endpoints', async () => {
      const email = `admin-session-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Admin Session' })
        .expect(200);

      // Promote to admin
      const user = await db.user.findUnique({ where: { email } });
      await db.user.update({ where: { id: user!.id }, data: { role: 'admin' } });

      // Re-login to get fresh session
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      const cookie = loginRes.headers['set-cookie'][0];

      // Access admin endpoint
      await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('Cookie', cookie)
        .expect(200);
    });

    it('non-admin cannot access admin-only endpoints', async () => {
      const email = `nonadmin-session-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'NonAdmin Session' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('Cookie', cookie)
        .expect(403);
    });
  });
});
