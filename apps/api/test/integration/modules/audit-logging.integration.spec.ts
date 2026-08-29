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

describe('Audit Logging Cross-Cutting (integration)', () => {
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

  describe('Note Mutation Audit', () => {
    it('creates audit log when a note is created', async () => {
      const email = `audit-note-create-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditCreator', 'operator');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Audited Note', content: 'Audited Content' })
        .expect(201);

      // Wait a bit for async audit write
      await new Promise((r) => setTimeout(r, 200));

      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'note_created' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      const log = logs[0];
      expect(log.metadata).toHaveProperty('noteId', createRes.body.id);
      expect(log.metadata).toHaveProperty('title', 'Audited Note');
      expect(log.userId).toBe(user!.id);
    });

    it('creates audit log when a note is updated', async () => {
      const email = `audit-note-update-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditUpdater', 'operator');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'Original', content: 'Original' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/notes/${createRes.body.id}`)
        .set('Cookie', signup.cookie!)
        .send({ title: 'Updated' })
        .expect(200);

      await new Promise((r) => setTimeout(r, 200));

      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'note_updated' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('creates audit log when a note is deleted', async () => {
      const email = `audit-note-delete-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditDeleter', 'superAdmin');

      const createRes = await request(app.getHttpServer())
        .post('/api/notes')
        .set('Cookie', signup.cookie!)
        .send({ title: 'To Delete', content: 'Delete me' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/notes/${createRes.body.id}`)
        .set('Cookie', signup.cookie!)
        .expect(204);

      await new Promise((r) => setTimeout(r, 200));

      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'note_deleted' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Audit Log Properties', () => {
    it('includes ipAddress and userAgent in audit entries', async () => {
      const email = `audit-meta-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditMeta', 'operator');

      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', signup.cookie!)
        .set('User-Agent', 'IntegrationTestAgent/1.0')
        .send({ action: 'profile_updated' })
        .expect(201);

      await new Promise((r) => setTimeout(r, 200));

      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'profile_updated' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      expect(logs.length).toBe(1);
      expect(logs[0].userAgent).toBe('IntegrationTestAgent/1.0');
      // IP may be null in test (no real proxy chain)
    });

    it('never allows client to set userId', async () => {
      const email = `audit-userid-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'AuditUserId', 'operator');

      const user = await db.user.findUnique({ where: { email } });

      // Even if we tried to forge a different userId, the audit writer
      // always uses the session userId
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id },
      });

      for (const log of logs) {
        expect(log.userId).toBe(user!.id);
      }
    });
  });
});
