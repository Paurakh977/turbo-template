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

describe('UsersModule (integration)', () => {
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

  describe('GET /api/users/me/role', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me/role')
        .expect(401);
    });

    it('returns the fresh role from the database', async () => {
      const email = `role-test-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'RoleTest', 'user');

      const res = await request(app.getHttpServer())
        .get('/api/users/me/role')
        .set('Cookie', signup.cookie!)
        .expect(200);

      expect(res.body).toHaveProperty('role');
      expect(typeof res.body.role).toBe('string');
    });

    it('returns updated role after admin promotion', async () => {
      const email = `role-promo-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Promo', 'user');

      // Initially should be 'user'
      const res1 = await request(app.getHttpServer())
        .get('/api/users/me/role')
        .set('Cookie', signup.cookie!)
        .expect(200);
      expect(res1.body.role).toBe('user');

      // Promote in DB
      const user = await db.user.findUnique({ where: { email } });
      await db.user.update({ where: { id: user!.id }, data: { role: 'admin' } });

      // Re-login to get fresh session
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      const cookie = loginRes.headers['set-cookie']?.[0];

      const res2 = await request(app.getHttpServer())
        .get('/api/users/me/role')
        .set('Cookie', cookie!)
        .expect(200);
      expect(res2.body.role).toBe('admin');
    });
  });

  describe('GET /api/users/me/permissions', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me/permissions')
        .expect(401);
    });

    it('returns permission matrix for a user', async () => {
      const email = `perm-test-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'PermTest', 'user');

      const res = await request(app.getHttpServer())
        .get('/api/users/me/permissions')
        .set('Cookie', signup.cookie!)
        .expect(200);

      expect(res.body).toHaveProperty('userId');
      expect(res.body).toHaveProperty('role');
      expect(res.body).toHaveProperty('permissions');
      expect(res.body.permissions).toHaveProperty('notes');
      expect(res.body.permissions).toHaveProperty('settings');
      expect(Array.isArray(res.body.permissions.notes)).toBe(true);
      expect(Array.isArray(res.body.permissions.settings)).toBe(true);
    });

    it('user role has limited permissions', async () => {
      const email = `perm-user-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'PermUser', 'user');

      const res = await request(app.getHttpServer())
        .get('/api/users/me/permissions')
        .set('Cookie', signup.cookie!)
        .expect(200);

      // user role should NOT have notes:create
      expect(res.body.permissions.notes).not.toContain('create');
      // user role should have settings:read
      expect(res.body.permissions.settings).toContain('read');
    });

    it('operator role has expanded permissions', async () => {
      const email = `perm-operator-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'PermOperator', 'user');

      // Promote to operator
      const user = await db.user.findUnique({ where: { email } });
      await db.user.update({ where: { id: user!.id }, data: { role: 'operator' } });

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      const cookie = loginRes.headers['set-cookie']?.[0];

      const res = await request(app.getHttpServer())
        .get('/api/users/me/permissions')
        .set('Cookie', cookie!)
        .expect(200);

      // operator should have notes:create and notes:list
      expect(res.body.permissions.notes).toContain('create');
      expect(res.body.permissions.notes).toContain('list');
    });
  });
});
