jest.mock('@repo/database', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@repo/auth', () => ({
  ADMIN_PLUGIN_ROLES: {
    user: {
      authorize: jest.fn().mockImplementation((perm: Record<string, string[]>) => {
        const resource = Object.keys(perm)[0];
        const actions = perm[resource];
        const allowed: Record<string, string[]> = {
          settings: ['read', 'profile', 'security'],
        };
        const allowedActions = allowed[resource] ?? [];
        const success = actions.some((a: string) => allowedActions.includes(a));
        return { success };
      }),
    },
    operator: {
      authorize: jest.fn().mockImplementation((perm: Record<string, string[]>) => {
        return { success: true };
      }),
    },
    admin: {
      authorize: jest.fn().mockImplementation((perm: Record<string, string[]>) => {
        return { success: true };
      }),
    },
    superAdmin: {
      authorize: jest.fn().mockImplementation((perm: Record<string, string[]>) => {
        return { success: true };
      }),
    },
  },
  statement: {
    notes: ['create', 'list', 'update', 'delete'],
    settings: ['read', 'profile', 'security', 'theme', 'labs'],
  },
}));

import { UsersController } from './users.controller';
import { db } from '@repo/database';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController();
  });

  function makeSession(userId = 'user-1', impersonatedBy?: string) {
    return {
      user: { id: userId, name: 'Test' },
      session: { impersonatedBy: impersonatedBy ?? null, id: 's1' },
    } as any;
  }

  describe('myRole', () => {
    it('returns the user role from the database', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'admin' });

      const result = await controller.myRole(makeSession());

      expect(result).toEqual({ role: 'admin' });
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { role: true },
      });
    });

    it('returns "user" as default when role is null', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: null });

      const result = await controller.myRole(makeSession());
      expect(result).toEqual({ role: 'user' });
    });

    it('returns "user" when user not found', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await controller.myRole(makeSession());
      expect(result).toEqual({ role: 'user' });
    });
  });

  describe('myPermissions', () => {
    it('returns permissions for the effective user', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'admin' });

      const result = await controller.myPermissions(makeSession());

      expect(result).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          role: 'admin',
          permissions: expect.objectContaining({
            notes: expect.any(Array),
            settings: expect.any(Array),
          }),
        }),
      );
    });

    it('uses effective user id when impersonating', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'user' });

      const result = await controller.myPermissions(
        makeSession('impersonated', 'admin-9'),
      );

      expect(result.userId).toBe('admin-9');
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'admin-9' },
        select: { role: true },
      });
    });

    it('returns empty permissions for default user role', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: 'user' });

      const result = await controller.myPermissions(makeSession());

      expect(result.permissions.notes).toEqual([]);
      expect(result.permissions.settings).toEqual(
        expect.arrayContaining(['read', 'profile', 'security']),
      );
    });

    it('falls back to "user" role when role is null', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue({ role: null });

      const result = await controller.myPermissions(makeSession());

      expect(result.role).toBe('user');
    });

    it('falls back to "user" role when user not found', async () => {
      (db.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await controller.myPermissions(makeSession());

      expect(result.role).toBe('user');
    });
  });
});
