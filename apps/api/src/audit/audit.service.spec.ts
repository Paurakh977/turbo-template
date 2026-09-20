// The mock below intercepts $transaction by executing the array of
// Prisma requests inline (each is a Promise, not a raw function), which
// mirrors the real Prisma.$transaction([...]) API shape.
jest.mock('@repo/database', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      return Promise.all(ops);
    }),
  },
}));

jest.mock('../common/audit-writer', () => ({
  writeAuditRow: jest.fn(),
}));

// AuthorizationService imports ADMIN_PLUGIN_ROLES/statement from @repo/auth
// (better-auth ESM). Mock it like users.controller.spec so unit tests never
// load the real server bundle.
jest.mock('@repo/auth', () => ({
  ADMIN_PLUGIN_ROLES: {
    user: { authorize: () => ({ success: false }) },
    operator: { authorize: () => ({ success: true }) },
    admin: { authorize: () => ({ success: true }) },
    superAdmin: { authorize: () => ({ success: true }) },
  },
  statement: {
    notes: ['create', 'list', 'update', 'delete'],
    settings: ['read', 'profile', 'security', 'theme', 'labs'],
  },
}));

import { AuditService } from './audit.service';
import { AuthorizationService } from '../common/authorization.service';
import { db } from '@repo/database';
import { writeAuditRow } from '../common/audit-writer';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService(new AuthorizationService());
    jest.clearAllMocks();
    // Default $transaction: execute the Promise array in order.
    (db.$transaction as jest.Mock).mockImplementation(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    );
  });

  describe('recordFromSession', () => {
    it('calls writeAuditRow with session and input', async () => {
      (writeAuditRow as jest.Mock).mockResolvedValue(undefined);
      const session = { user: { id: 'u1' }, session: { token: 't' } } as any;
      await service.recordFromSession(
        session,
        { action: 'theme_changed', metadata: { theme: 'dark' } },
        { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
      );
      expect(writeAuditRow).toHaveBeenCalledWith(
        session,
        { action: 'theme_changed', metadata: { theme: 'dark' } },
        { ip: '1.2.3.4', userAgent: 'Mozilla/5.0' },
      );
    });
  });

  describe('listForAdmin', () => {
    const adminSession = {
      user: { id: 'admin-1', role: 'admin' },
      session: { token: 't' },
    } as any;

    it('throws ForbiddenException when user is not admin', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        role: 'user',
      });

      await expect(
        service.listForAdmin(adminSession, {}),
      ).rejects.toThrow('Admin role required.');
    });

    it('throws when user row is missing (deleted user)', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.listForAdmin(adminSession, {}),
      ).rejects.toThrow('Admin role required.');
    });

    it('returns paginated logs for admin', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(25);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-1',
          userId: 'u1',
          action: 'user_signed_up',
          actor: null,
          ipAddress: '1.2.3.4',
          userAgent: 'Mozilla',
          metadata: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);
      (db.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'u1', name: 'Test', email: 'test@example.com' },
      ]);

      const result = await service.listForAdmin(adminSession, {
        page: 1,
      });
      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.usersById['u1']).toEqual({
        id: 'u1',
        name: 'Test',
        email: 'test@example.com',
      });
    });

    it('filters by action', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (db.user.findMany as jest.Mock).mockResolvedValue([]);

      await service.listForAdmin(adminSession, { action: 'role_changed' });

      // $transaction receives the Prisma promise objects; to verify the where
      // clause we inspect the auditLog.count mock directly.
      const countCallArgs = (db.auditLog.count as jest.Mock).mock.calls[0][0];
      expect(countCallArgs.where.action).toBe('role_changed');
    });

    it('searches by query across userId, actor, and user name/email', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.user.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'found-user' }]) // user search (fuzzy)
        .mockResolvedValueOnce([]); // user display lookup
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.listForAdmin(adminSession, { q: 'test@example.com' });

      // First call is the user ILIKE search.
      const userSearchWhere = (db.user.findMany as jest.Mock).mock
        .calls[0][0].where;
      expect(userSearchWhere.OR).toBeDefined();
    });

    it('skips user table ILIKE scan for ID-shaped queries', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      // No user.findMany for identity resolution when page is empty.

      // ID-shaped query — 20+ alphanumeric chars.
      await service.listForAdmin(adminSession, {
        q: 'clzxxxxxxxxxxxxxxxxxxx',
      });

      // user.findMany should NOT have been called for the ILIKE search
      // (only possibly for user-display resolution, which has 0 userIds here).
      // Verify either 0 calls or the first call is NOT the ILIKE search.
      const calls = (db.user.findMany as jest.Mock).mock.calls;
      const ilikeCall = calls.find(
        (c: any) => c[0]?.where?.OR?.[0]?.email?.contains !== undefined,
      );
      expect(ilikeCall).toBeUndefined();
    });

    it('clamps page to valid range', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(10);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (db.user.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listForAdmin(adminSession, { page: 999 });
      // totalPages = ceil(10/50) = 1, so page 999 gets clamped to 1
      expect(result.page).toBe(1);
    });

    it('defaults to page 1 when no page specified', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (db.user.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listForAdmin(adminSession, {});
      expect(result.page).toBe(1);
    });

    it('skips action filter for "all"', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (db.user.findMany as jest.Mock).mockResolvedValue([]);

      await service.listForAdmin(adminSession, { action: 'all' });
      const countCallArgs = (db.auditLog.count as jest.Mock).mock.calls[0][0];
      expect(countCallArgs.where.action).toBeUndefined();
    });

    it('skips user.findMany when no userIds on page (empty-array guard)', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.auditLog.count as jest.Mock).mockResolvedValue(1);
      // Log row with no userId, no actor, no metadata impersonation.
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-sys',
          userId: null,
          action: 'system_event',
          actor: null,
          ipAddress: null,
          userAgent: null,
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      await service.listForAdmin(adminSession, {});

      // user.findMany should NOT be called for display resolution (no userIds).
      const displayLookupCalls = (db.user.findMany as jest.Mock).mock.calls;
      const hasUserLookup = displayLookupCalls.some(
        (c: any) => c[0]?.where?.id?.in !== undefined,
      );
      expect(hasUserLookup).toBe(false);
    });
  });
});
