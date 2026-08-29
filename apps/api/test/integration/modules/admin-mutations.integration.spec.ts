import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi, loginUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

function cookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const all = res.headers['set-cookie'];
  if (!all) return undefined;
  const arr = Array.isArray(all) ? all : [all];
  return arr.find(
    (c: string) =>
      c.toLowerCase().includes('better-auth.session_token') &&
      !c.toLowerCase().includes('max-age=0'),
  );
}

describe('Admin Mutation Endpoints (integration)', () => {
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

  async function makeUser(role = 'user') {
    const email = `admin-${role}-${Date.now()}-${Math.floor(Math.random() * 9999)}@test.com`;
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, `Admin ${role}`);
    if (role !== 'user') {
      await db.user.update({ where: { id: signup.userId }, data: { role } });
    }
    const login = await loginUserViaApi(app, email, TEST_PASSWORD);
    return { cookie: login.cookie!, userId: signup.userId!, email };
  }

  describe('set-role (promote / demote)', () => {
    it('allows a superAdmin to change another user role', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');

      await request(app.getHttpServer())
        .post('/api/auth/admin/set-role')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId, role: 'operator' })
        .expect(200);

      const updated = await db.user.findUnique({ where: { id: target.userId } });
      expect(updated?.role).toBe('operator');

      // Demote back
      await request(app.getHttpServer())
        .post('/api/auth/admin/set-role')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId, role: 'user' })
        .expect(200);
      const demoted = await db.user.findUnique({ where: { id: target.userId } });
      expect(demoted?.role).toBe('user');
    });

    it('forbids a regular user from changing roles (403)', async () => {
      const user = await makeUser('user');
      const target = await makeUser('user');

      await request(app.getHttpServer())
        .post('/api/auth/admin/set-role')
        .set('Cookie', user.cookie)
        .send({ userId: target.userId, role: 'admin' })
        .expect(403);
    });

    it('forbids an admin from granting superAdmin (impersonate-admins required)', async () => {
      const admin = await makeUser('admin');
      const target = await makeUser('user');

      await request(app.getHttpServer())
        .post('/api/auth/admin/set-role')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId, role: 'superAdmin' })
        .expect(403);
    });
  });

  describe('ban / unban', () => {
    it('bans a user (revoking sessions) and blocks sign-in; unban restores', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');

      await request(app.getHttpServer())
        .post('/api/auth/admin/ban-user')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId, banReason: 'spam' })
        .expect(200);

      const banned = await db.user.findUnique({ where: { id: target.userId } });
      expect(banned?.banned).toBe(true);

      // Sign-in must now fail (banned -> 403)
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/auth/admin/unban-user')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId })
        .expect(200);

      const unbanned = await db.user.findUnique({ where: { id: target.userId } });
      expect(unbanned?.banned).toBe(false);

      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(200);
    });

    it('forbids a non-admin from banning (403)', async () => {
      const user = await makeUser('user');
      const target = await makeUser('user');
      await request(app.getHttpServer())
        .post('/api/auth/admin/ban-user')
        .set('Cookie', user.cookie)
        .send({ userId: target.userId })
        .expect(403);
    });
  });

  describe('impersonate / stop-impersonating', () => {
    it('lets a superAdmin impersonate a user and then stop', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');

      const imp = await request(app.getHttpServer())
        .post('/api/auth/admin/impersonate-user')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId })
        .expect(200);
      const impCookie = cookieOf(imp);
      expect(impCookie).toBeDefined();

      // The impersonation response carries the impersonated user, and the
      // impersonation metadata is set server-side (not client-forgeable).
      expect(imp.body.user.id).toBe(target.userId);
      expect(imp.body.session.impersonatedBy).toBe(admin.userId);

      // stop-impersonating needs the impersonation session AND the preserved
      // admin_session cookie returned by the impersonate call.
      const allCookies = Array.isArray(imp.headers['set-cookie'])
        ? imp.headers['set-cookie']
        : [imp.headers['set-cookie']];
      const stopCookie = allCookies
        .filter((c: string) => !c.toLowerCase().includes('max-age=0'))
        .map((c: string) => c.split(';')[0])
        .join('; ');

      await request(app.getHttpServer())
        .post('/api/auth/admin/stop-impersonating')
        .set('Cookie', stopCookie)
        .expect(200);
    });

    it('forbids an admin from impersonating a superAdmin', async () => {
      const admin = await makeUser('admin');
      const target = await makeUser('superAdmin');
      await request(app.getHttpServer())
        .post('/api/auth/admin/impersonate-user')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId })
        .expect(403);
    });
  });

  describe('remove-user', () => {
    it('removes a user entirely', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');
      await request(app.getHttpServer())
        .post('/api/auth/admin/remove-user')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId })
        .expect(200);
      const gone = await db.user.findUnique({ where: { id: target.userId } });
      expect(gone).toBeNull();
    });
  });

  describe('revoke-user-sessions', () => {
    it('revokes a target user active sessions', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');

      // Target has a live session (its login cookie)
      const live = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', target.cookie)
        .expect(200);
      expect(live.body).not.toBeNull();

      await request(app.getHttpServer())
        .post('/api/auth/admin/revoke-user-sessions')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId })
        .expect(200);

      const killed = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', target.cookie)
        .expect(200);
      expect(killed.body).toBeNull();
    });
  });

  describe('create-user / set-user-password', () => {
    it('creates a user via the admin endpoint', async () => {
      const admin = await makeUser('superAdmin');
      const email = `created-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/admin/create-user')
        .set('Cookie', admin.cookie)
        .send({ email, password: TEST_PASSWORD, name: 'Created', role: 'operator' })
        .expect(200);
      const created = await db.user.findUnique({ where: { email } });
      expect(created).not.toBeNull();
      expect(created?.role).toBe('operator');
    });

    it('changes a user password via the admin endpoint', async () => {
      const admin = await makeUser('superAdmin');
      const target = await makeUser('user');
      const newPassword = 'NewPassword123!';
      await request(app.getHttpServer())
        .post('/api/auth/admin/set-user-password')
        .set('Cookie', admin.cookie)
        .send({ userId: target.userId, newPassword })
        .expect(200);

      // Old password rejected, new password accepted
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email: target.email, password: newPassword })
        .expect(200);
    });
  });
});
