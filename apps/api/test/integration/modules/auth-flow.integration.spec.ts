import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';

const TEST_PASSWORD = 'TestPassword123!';

describe('Auth Flow (integration)', () => {
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

  describe('Registration', () => {
    it('registers a new user via email/password', async () => {
      const email = `register-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'New User' })
        .expect(200);

      // Should have session cookies
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects registration with existing email', async () => {
      const email = `dup-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'User 1' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'User 2' })
        .expect(422);
    });

    it('rejects registration with weak password', async () => {
      const email = `weak-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: '123', name: 'Weak' })
        .expect(400);
    });
  });

  describe('Login', () => {
    it('logs in with correct credentials', async () => {
      const email = `login-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Login User' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects login with wrong password', async () => {
      const email = `login-wrong-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Wrong PW' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'WrongPassword123!' })
        .expect(401);
    });

    it('rejects login with non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: 'nonexistent@test.com', password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('Session', () => {
    it('returns session for authenticated request', async () => {
      const email = `session-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Session User' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body).toHaveProperty('session');
      expect(res.body).toHaveProperty('user');
      expect(res.body.user.email).toBe(email);
    });

    it('returns 200 with no active session for invalid/missing session', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .expect(200);

      // Better Auth returns a null body when no session is present.
      expect(res.body).toBeNull();
    });
  });

  describe('Logout', () => {
    it('invalidates the session on logout', async () => {
      const email = `logout-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Logout User' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      // Verify session is valid
      await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      // Logout
      await request(app.getHttpServer())
        .post('/api/auth/sign-out')
        .set('Cookie', cookie)
        .expect(200);

      // Session should be invalid now — Better Auth returns 200 with null body
      const res = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body).toBeNull();
    });
  });

  describe('Password Reset', () => {
    it('initiates password reset flow', async () => {
      const email = `reset-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Reset User' })
        .expect(200);

      // Request password reset (won't actually send email in test env)
      const res = await request(app.getHttpServer())
        .post('/api/auth/request-password-reset')
        .send({ email })
        .expect(200);

      // Better Auth always returns 200 to prevent email enumeration
    });
  });

  describe('User Lifecycle', () => {
    it('allows user to delete their own account', async () => {
      const email = `delete-${Date.now()}@test.com`;
      const signup = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Delete User' })
        .expect(200);

      const cookie = signup.headers['set-cookie'][0];

      // Delete account (requires password for credential accounts)
      const res = await request(app.getHttpServer())
        .post('/api/auth/delete-user')
        .set('Cookie', cookie)
        .send({ password: TEST_PASSWORD })
        .expect(200);

      // Verify user is deleted
      const user = await db.user.findUnique({ where: { email } });
      expect(user).toBeNull();
    });
  });
});
