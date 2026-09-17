jest.mock('@repo/database', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('better-auth/api', () => ({
  createAuthMiddleware: (fn: Function) => fn,
  getSessionFromCtx: jest.fn(),
  APIError: class APIError extends Error {
    status: string;
    body: unknown;
    constructor(status: string, body: unknown) {
      super(status);
      this.status = status;
      this.body = body;
    }
  },
}));

jest.mock('./pending-storage', () => ({
  invalidateUserCache: jest.fn(),
  storePendingDeletion: jest.fn(),
  storePendingStopImpersonation: jest.fn(),
}));

jest.mock('../shared/client-ip', () => ({
  resolveClientIp: jest.fn().mockReturnValue('127.0.0.1'),
  TRUSTED_PROXY_CIDRS: ['10.0.0.0/8'],
}));

import { enforceRoleHierarchy } from './hierarchy';
import { db } from '@repo/database';
import { getSessionFromCtx } from 'better-auth/api';

describe('enforceRoleHierarchy', () => {
  const mockCtx = { headers: { get: jest.fn() } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws UNAUTHORIZED when session is missing', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue(null);

    await expect(
      enforceRoleHierarchy(mockCtx, 'target-user-id'),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  it('throws NOT_FOUND when target user does not exist', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: 'admin' },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      enforceRoleHierarchy(mockCtx, 'nonexistent'),
    ).rejects.toMatchObject({ status: 'NOT_FOUND' });
  });

  it('throws FORBIDDEN when actor targets a peer or superior', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: 'admin' },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'target-1',
      role: 'admin',
    });

    await expect(
      enforceRoleHierarchy(mockCtx, 'target-1'),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
  });

  it('throws FORBIDDEN when actor targets a superior', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: 'operator' },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'target-1',
      role: 'admin',
    });

    await expect(
      enforceRoleHierarchy(mockCtx, 'target-1'),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
  });

  it('allows actor to target a user with lower role', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: 'admin' },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'target-1',
      role: 'user',
    });

    await expect(
      enforceRoleHierarchy(mockCtx, 'target-1'),
    ).resolves.toBeUndefined();
  });

  it('allows superAdmin to target admin', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: 'superAdmin' },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'target-1',
      role: 'admin',
    });

    await expect(
      enforceRoleHierarchy(mockCtx, 'target-1'),
    ).resolves.toBeUndefined();
  });

  it('treats missing role as user', async () => {
    (getSessionFromCtx as jest.Mock).mockResolvedValue({
      user: { id: 'actor-1', role: undefined },
    });
    (db.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'target-1',
      role: null,
    });

    // Both default to 'user' (weight 0), so same weight = FORBIDDEN
    await expect(
      enforceRoleHierarchy(mockCtx, 'target-1'),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' });
  });
});
