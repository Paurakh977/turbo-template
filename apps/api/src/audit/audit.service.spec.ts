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
  },
}));

jest.mock('../common/audit-writer', () => ({
  writeAuditRow: jest.fn(),
}));

import { AuditService } from './audit.service';
import { db } from '@repo/database';
import { writeAuditRow } from '../common/audit-writer';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
    jest.clearAllMocks();
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
      const where = (db.auditLog.count as jest.Mock).mock.calls[0][0].where;
      expect(where.action).toBe('role_changed');
    });

    it('searches by query across userId, actor, and user name/email', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        role: 'admin',
      });
      (db.user.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'found-user' }]) // user search
        .mockResolvedValueOnce([]); // user display lookup
      (db.auditLog.count as jest.Mock).mockResolvedValue(0);
      (db.auditLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.listForAdmin(adminSession, { q: 'test@example.com' });

      // First call is the user search
      const userSearchWhere = (db.user.findMany as jest.Mock).mock
        .calls[0][0].where;
      expect(userSearchWhere.OR).toBeDefined();
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
      const where = (db.auditLog.count as jest.Mock).mock.calls[0][0].where;
      expect(where.action).toBeUndefined();
    });
  });
});
