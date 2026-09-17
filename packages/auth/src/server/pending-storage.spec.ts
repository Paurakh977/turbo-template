jest.mock('./infra/redis', () => ({
  redis: null,
}));

jest.mock('@repo/database', () => ({
  db: {
    session: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import {
  storePendingDeletion,
  popPendingDeletion,
  storePendingUser,
  popPendingUser,
  storePendingStopImpersonation,
  popPendingStopImpersonation,
  invalidateUserCache,
  PENDING_TTL_MS,
} from './pending-storage';

import { db } from '@repo/database';

describe('pending-storage (in-memory fallback)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('storePendingDeletion / popPendingDeletion', () => {
    it('stores and retrieves deletion metadata', async () => {
      const meta = {
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        email: 'test@example.com',
        sessionToken: 'tok_123',
        sessionId: 'sess_123',
      };

      await storePendingDeletion('user-1', meta);
      const result = await popPendingDeletion('user-1');

      expect(result).toEqual(meta);
    });

    it('returns undefined for non-existent key', async () => {
      const result = await popPendingDeletion('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns undefined after TTL expiry', async () => {
      const meta = {
        ipAddress: null,
        userAgent: null,
        email: 'test@example.com',
        sessionToken: null,
        sessionId: null,
      };

      await storePendingDeletion('user-1', meta);
      jest.advanceTimersByTime(PENDING_TTL_MS + 1);
      const result = await popPendingDeletion('user-1');

      expect(result).toBeUndefined();
    });

    it('deletes entry after pop (atomic)', async () => {
      const meta = {
        ipAddress: '10.0.0.1',
        userAgent: 'ua',
        email: 'a@b.com',
        sessionToken: 't',
        sessionId: 's',
      };

      await storePendingDeletion('user-1', meta);
      await popPendingDeletion('user-1');
      const second = await popPendingDeletion('user-1');

      expect(second).toBeUndefined();
    });
  });

  describe('storePendingUser / popPendingUser', () => {
    it('stores and retrieves user data', async () => {
      const data = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
      };

      await storePendingUser('user-1', data);
      const result = await popPendingUser('user-1');

      expect(result).toEqual(data);
    });

    it('returns undefined for non-existent key', async () => {
      const result = await popPendingUser('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns undefined after TTL expiry', async () => {
      const data = {
        id: 'user-1',
        email: 'test@example.com',
      };

      await storePendingUser('user-1', data);
      jest.advanceTimersByTime(PENDING_TTL_MS + 1);
      const result = await popPendingUser('user-1');

      expect(result).toBeUndefined();
    });

    it('deletes entry after pop', async () => {
      const data = { id: 'user-1', email: 'a@b.com' };

      await storePendingUser('user-1', data);
      await popPendingUser('user-1');
      const second = await popPendingUser('user-1');

      expect(second).toBeUndefined();
    });
  });

  describe('storePendingStopImpersonation / popPendingStopImpersonation', () => {
    it('stores and pops impersonation stop flag', async () => {
      await storePendingStopImpersonation('user-1');
      const result = await popPendingStopImpersonation('user-1');

      expect(result).toBe(true);
    });

    it('returns false for non-existent key', async () => {
      const result = await popPendingStopImpersonation('nonexistent');
      expect(result).toBe(false);
    });

    it('deletes flag after pop', async () => {
      await storePendingStopImpersonation('user-1');
      await popPendingStopImpersonation('user-1');
      const second = await popPendingStopImpersonation('user-1');

      expect(second).toBe(false);
    });
  });

  describe('invalidateUserCache', () => {
    it('is a no-op when redis is null', async () => {
      await invalidateUserCache('user-1');
      expect(db.session.findMany).not.toHaveBeenCalled();
    });
  });

  describe('separate stores', () => {
    it('user updates and deletions use separate maps', async () => {
      const deletionMeta = {
        ipAddress: '10.0.0.1',
        userAgent: 'ua',
        email: 'del@b.com',
        sessionToken: 'dt',
        sessionId: 'ds',
      };
      const userData = {
        id: 'user-1',
        email: 'upd@b.com',
      };

      await storePendingDeletion('user-1', deletionMeta);
      await storePendingUser('user-1', userData);

      const deletion = await popPendingDeletion('user-1');
      const user = await popPendingUser('user-1');

      expect(deletion).toEqual(deletionMeta);
      expect(user).toEqual(userData);
    });
  });
});
