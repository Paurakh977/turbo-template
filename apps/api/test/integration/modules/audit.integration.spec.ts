import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { USER_FIXTURES, seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('AuditModule (integration)', () => {
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

  describe('POST /api/audit-logs', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .send({ action: 'profile_updated' })
        .expect(401);
    });

    it('records an audit log for an authenticated user', async () => {
      const email = `audit-record-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'Auditor', 'operator');

      const res = await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', signup.cookie!)
        .send({ action: 'profile_updated', metadata: { field: 'name' } })
        .expect(201);

      // Verify the audit log was written to the database
      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'profile_updated' },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects actions not in the allowlist', async () => {
      const email = `audit-deny-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditorDeny', 'operator');

      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', signup.cookie!)
        .send({ action: 'super_admin_action' })
        .expect(400);
    });

    it('accepts all allowed actions', async () => {
      const email = `audit-all-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditorAll', 'operator');

      for (const action of ['profile_updated', 'theme_changed', 'labs_toggled']) {
        await request(app.getHttpServer())
          .post('/api/audit-logs')
          .set('Cookie', signup.cookie!)
          .send({ action })
          .expect(201);
      }
    });

    it('rejects metadata exceeding 4096 characters', async () => {
      const email = `audit-big-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'BigMeta', 'operator');

      const largeMetadata = { data: 'x'.repeat(5000) };
      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', signup.cookie!)
        .send({ action: 'profile_updated', metadata: largeMetadata })
        .expect(400);
    });
  });

  describe('GET /api/admin/audit-logs', () => {
    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .expect(401);
    });

    it('returns 403 for non-admin users', async () => {
      const email = `audit-nonadmin-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'NonAdmin', 'user');

      await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('Cookie', signup.cookie!)
        .expect(403);
    });

    it('returns audit logs for admin users', async () => {
      // Promote user to admin
      const email = `audit-admin-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AdminAuditor', 'admin');
      const user = await db.user.findUnique({ where: { email } });
      await db.user.update({ where: { id: user!.id }, data: { role: 'admin' } });

      // Re-login to get fresh session
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      const cookie = loginRes.headers['set-cookie']?.[0];

      // Create an audit log first
      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', cookie!)
        .send({ action: 'profile_updated' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/audit-logs')
        .set('Cookie', cookie!)
        .expect(200);

      expect(res.body).toHaveProperty('logs');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('supports pagination', async () => {
      const email = `audit-page-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'PageAuditor', 'admin');
      const user = await db.user.findUnique({ where: { email } });
      await db.user.update({ where: { id: user!.id }, data: { role: 'admin' } });

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      const cookie = loginRes.headers['set-cookie']?.[0];

      const res = await request(app.getHttpServer())
        .get('/api/admin/audit-logs?page=1')
        .set('Cookie', cookie!)
        .expect(200);

      expect(res.body).toHaveProperty('page', 1);
    });
  });
});
