const getMock = jest.fn();
const delMock = jest.fn();
const getdelMock = jest.fn();
const evalMock = jest.fn();
const pipelineDelMock = jest.fn();
const pipelineExecMock = jest.fn();
const setMock = jest.fn();

jest.mock('./infra/redis', () => ({
  redis: {
    get: (...args: unknown[]) => getMock(...(args as [])),
    del: (...args: unknown[]) => delMock(...(args as [])),
    getdel: (...args: unknown[]) => getdelMock(...(args as [])),
    eval: (...args: unknown[]) => evalMock(...(args as [])),
    set: (...args: unknown[]) => setMock(...(args as [])),
    pipeline: () => ({
      del: (...args: unknown[]) => pipelineDelMock(...(args as [])),
      exec: (...args: unknown[]) => pipelineExecMock(...(args as [])),
    }),
  },
}));

jest.mock('@repo/database', () => ({
  db: {
    session: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import {
  popPendingDeletion,
  popPendingStopImpersonation,
  popPendingUser,
  invalidateUserCache,
} from './pending-storage';

import { db } from '@repo/database';

describe('pending-storage (Redis path, Phase 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pipelineExecMock.mockResolvedValue([]);
  });

  it('pops with a single GETDEL (no separate GET + DEL)', async () => {
    getdelMock.mockResolvedValue(
      JSON.stringify({ id: 'user-1', email: 'a@b.com' }),
    );

    const result = await popPendingUser('user-1');

    expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
    expect(getdelMock).toHaveBeenCalledTimes(1);
    expect(getdelMock).toHaveBeenCalledWith('pending_user_update:user-1');
    expect(getMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('falls back to Lua GET+DEL when GETDEL is unavailable', async () => {
    getdelMock.mockRejectedValue(new Error('ERR unknown command `getdel`'));
    evalMock.mockResolvedValue(JSON.stringify({ flag: true }));

    // pending_stop_impersonation stores the literal '1'; any value pops true.
    const result = await popPendingStopImpersonation('user-1');

    expect(result).toBe(true);
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(String(evalMock.mock.calls[0][0])).toContain("redis.call('GET'");
    expect(delMock).not.toHaveBeenCalled();
  });

  it('returns empty when both GETDEL and Lua fail (memory fallback miss)', async () => {
    getdelMock.mockRejectedValue(new Error('down'));
    evalMock.mockRejectedValue(new Error('down'));

    await expect(popPendingDeletion('ghost')).resolves.toBeUndefined();
    await expect(popPendingStopImpersonation('ghost')).resolves.toBe(false);
  });

  it('invalidateUserCache dels bare tokens + active-sessions list in one pipeline', async () => {
    (db.session.findMany as jest.Mock).mockResolvedValue([
      { token: 'tok-a' },
      { token: 'tok-b' },
    ]);

    await invalidateUserCache('user-1', { sessionToken: 'tok-self' });

    const delled = pipelineDelMock.mock.calls.map((c) => c[0]);
    expect(delled).toContain('tok-a');
    expect(delled).toContain('tok-b');
    // Phase 3 correction: framework-owned session-id list is deleted too.
    expect(delled).toContain('active-sessions-user-1');
    // Self-delete window token.
    expect(delled).toContain('tok-self');
    // And never the dead prefixed shapes.
    expect(delled.every((k: string) => !k.startsWith('session:'))).toBe(true);
    expect(delled.every((k: string) => !k.startsWith('user:'))).toBe(true);
    expect(pipelineExecMock).toHaveBeenCalledTimes(1);
  });
});
