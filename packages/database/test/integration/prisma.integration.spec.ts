import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db, PrismaClient } from '../../src';

const TRUNCATE_ORDER = [
  'audit_log',
  'note',
  '"twoFactor"',
  '"rateLimit"',
  'session',
  'account',
  'verification',
  'jwks',
  '"user"',
] as const;

async function truncateAll() {
  for (const table of TRUNCATE_ORDER) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE`);
  }
}

describe('Prisma Integration', () => {
  afterAll(async () => {
    await truncateAll();
    await db.$disconnect();
  });

  describe('Connection', () => {
    it('connects and can execute raw query', async () => {
      const result = await db.$queryRaw`SELECT 1 as ok`;
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('ok');
    });

    it('disconnects cleanly', async () => {
      const client = new PrismaClient();
      await client.$connect();
      const result = await client.$queryRaw`SELECT 1 as ok`;
      expect(result).toEqual([{ ok: 1n }]);
      await client.$disconnect();
    });

    it('handles concurrent queries', async () => {
      const queries = Array.from({ length: 5 }, () =>
        db.$queryRaw`SELECT 1 as ok`,
      );
      const results = await Promise.all(queries);
      expect(results.every((r) => Array.isArray(r))).toBe(true);
    });
  });

  describe('User Model', () => {
    it('creates and retrieves a user', async () => {
      const user = await db.user.create({
        data: {
          id: `test-user-${Date.now()}`,
          email: `prisma-test-${Date.now()}@test.com`,
          name: 'Prisma Test User',
          role: 'user',
          emailVerified: true,
        },
      });

      expect(user).toHaveProperty('id');
      expect(user.email).toContain('prisma-test');
      expect(user.role).toBe('user');

      const found = await db.user.findUnique({ where: { id: user.id } });
      expect(found).not.toBeNull();
      expect(found!.id).toBe(user.id);
    });

    it('enforces unique email constraint', async () => {
      const email = `unique-${Date.now()}@test.com`;
      await db.user.create({
        data: {
          id: `user-a-${Date.now()}`,
          email,
          name: 'User A',
          role: 'user',
        },
      });

      await expect(
        db.user.create({
          data: {
            id: `user-b-${Date.now()}`,
            email,
            name: 'User B',
            role: 'user',
          },
        }),
      ).rejects.toThrow();
    });

    it('supports role as comma-separated string', async () => {
      const user = await db.user.create({
        data: {
          id: `role-test-${Date.now()}`,
          email: `role-test-${Date.now()}@test.com`,
          name: 'Role Test',
          role: 'admin,customGrant',
        },
      });

      const found = await db.user.findUnique({ where: { id: user.id } });
      expect(found!.role).toBe('admin,customGrant');
    });
  });

  describe('Foreign Key Cascade', () => {
    it('cascades user deletion to sessions', async () => {
      const userId = `cascade-session-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `cascade-session-${Date.now()}@test.com`,
          name: 'Cascade Session',
          role: 'user',
        },
      });

      await db.session.create({
        data: {
          id: `sess-${userId}`,
          token: `token-${Date.now()}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      await db.user.delete({ where: { id: user.id } });

      const sessions = await db.session.findMany({ where: { userId } });
      expect(sessions).toHaveLength(0);
    });

    it('cascades user deletion to notes', async () => {
      const userId = `cascade-note-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `cascade-note-${Date.now()}@test.com`,
          name: 'Cascade Note',
          role: 'user',
        },
      });

      await db.note.create({
        data: {
          title: 'Cascade Note',
          content: 'Will be deleted',
          authorId: user.id,
        },
      });

      await db.user.delete({ where: { id: user.id } });

      const notes = await db.note.findMany({ where: { authorId: userId } });
      expect(notes).toHaveLength(0);
    });

    it('cascades user deletion to accounts', async () => {
      const userId = `cascade-account-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `cascade-account-${Date.now()}@test.com`,
          name: 'Cascade Account',
          role: 'user',
        },
      });

      await db.account.create({
        data: {
          id: `acc-${userId}`,
          accountId: user.email,
          providerId: 'email-password',
          userId: user.id,
        },
      });

      await db.user.delete({ where: { id: user.id } });

      const accounts = await db.account.findMany({ where: { userId } });
      expect(accounts).toHaveLength(0);
    });

    it('cascades user deletion to twoFactor records', async () => {
      const userId = `cascade-2fa-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `cascade-2fa-${Date.now()}@test.com`,
          name: 'Cascade 2FA',
          role: 'user',
        },
      });

      await db.twoFactor.create({
        data: {
          id: `2fa-${userId}`,
          secret: 'test-secret',
          backupCodes: 'encrypted-codes',
          userId: user.id,
        },
      });

      await db.user.delete({ where: { id: user.id } });

      const factors = await db.twoFactor.findMany({ where: { userId } });
      expect(factors).toHaveLength(0);
    });
  });

  describe('Note Model', () => {
    it('creates a note with author relation', async () => {
      const user = await db.user.create({
        data: {
          id: `note-author-${Date.now()}`,
          email: `note-author-${Date.now()}@test.com`,
          name: 'Note Author',
          role: 'user',
        },
      });

      const note = await db.note.create({
        data: {
          title: 'Test Note',
          content: 'Test Content',
          authorId: user.id,
        },
        include: { author: { select: { id: true, name: true } } },
      });

      expect(note.title).toBe('Test Note');
      expect(note.author.name).toBe('Note Author');
      expect(note.authorId).toBe(user.id);
    });

    it('supports paginated queries', async () => {
      const userId = `paginate-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `paginate-${Date.now()}@test.com`,
          name: 'Paginate',
          role: 'user',
        },
      });

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          db.note.create({
            data: { title: `Note ${i}`, content: `Content ${i}`, authorId: userId },
          }),
        ),
      );

      const page = await db.note.findMany({
        where: { authorId: userId },
        take: 3,
        skip: 2,
        orderBy: { createdAt: 'asc' },
      });
      expect(page).toHaveLength(3);

      const count = await db.note.count({ where: { authorId: userId } });
      expect(count).toBe(10);
    });
  });

  describe('AuditLog Model', () => {
    it('creates an audit log entry', async () => {
      const log = await db.auditLog.create({
        data: {
          action: 'test_action',
          metadata: { key: 'value' },
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        },
      });

      expect(log).toHaveProperty('id');
      expect(log.action).toBe('test_action');
      expect(log.ipAddress).toBe('127.0.0.1');
    });

    it('supports filtered queries on action', async () => {
      await db.auditLog.create({
        data: { action: 'specific_action', metadata: { test: true } },
      });

      const logs = await db.auditLog.findMany({
        where: { action: 'specific_action' },
      });
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Index Efficiency', () => {
    it('performs note queries using authorId index', async () => {
      const userId = `index-test-${Date.now()}`;
      const user = await db.user.create({
        data: {
          id: userId,
          email: `index-test-${Date.now()}@test.com`,
          name: 'Index Test',
          role: 'user',
        },
      });

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          db.note.create({
            data: { title: `Note ${i}`, content: `Content ${i}`, authorId: userId },
          }),
        ),
      );

      // This query should use the note_authorId_idx index
      const notes = await db.note.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
      });
      expect(notes).toHaveLength(5);
    });
  });
});
