import { jest } from '@jest/globals';

const userFindUnique = jest.fn();

jest.mock('@repo/database', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...(args as [])) },
  },
}));

jest.mock('@repo/auth', () => ({
  ADMIN_PLUGIN_ROLES: {},
  statement: { notes: [], settings: [] },
}));

import { AuthorizationService } from './authorization.service';
import { RequestContextInterceptor } from './request-context.interceptor';
import { getRequestContext, requestContextMiddleware } from './request-context';

function makeSession(opts: { userId?: string; impersonatedBy?: string | null } = {}) {
  return {
    user: { id: opts.userId ?? 'user-1' },
    session: { impersonatedBy: opts.impersonatedBy ?? null },
  } as never;
}

/**
 * Runs `fn` inside the MODULE's AsyncLocalStorage (via the real middleware),
 * so `getRequestContext()` inside the implementation under test resolves.
 * A test-local AsyncLocalStorage instance would NOT share state with it.
 */
function runInRequest<T>(fn: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestContextMiddleware(
      {} as never,
      {} as never,
      (() => {
        void (async () => {
          try {
            resolve(await fn());
          } catch (error) {
            reject(error);
          }
        })();
      }) as never,
    );
  });
}

describe('request-context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns undefined outside a request (workers, tests, boot)', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates concurrent requests (no cross-talk between stores)', async () => {
    const seen: Array<string | undefined> = [];
    const runRequest = (id: string, waitMs: number) =>
      new Promise<void>((resolve) => {
        requestContextMiddleware(
          {} as never,
          {} as never,
          (() => {
            const store = getRequestContext();
            if (store) store.requestId = id;
            setTimeout(() => {
              seen.push(getRequestContext()?.requestId);
              resolve();
            }, waitMs);
          }) as never,
        );
      });
    await Promise.all([runRequest('req-a', 20), runRequest('req-b', 5)]);
    expect(seen.sort()).toEqual(['req-a', 'req-b']);
  });

  it('interceptor populates ids + client meta from the guard-resolved session', async () => {
    const interceptor = new RequestContextInterceptor();
    const next = { handle: jest.fn(() => 'ok' as never) } as never;

    const req = {
      session: makeSession({ userId: 'user-1', impersonatedBy: 'admin-9' }),
      ip: '10.0.0.1',
      headers: { 'user-agent': 'jest' },
    };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;

    await runInRequest(() => {
      const result = interceptor.intercept(ctx, next);
      expect(result).toBe('ok');
      const store = getRequestContext();
      expect(store?.sessionUserId).toBe('user-1');
      expect(store?.effectiveUserId).toBe('admin-9');
      expect(store?.impersonatedBy).toBe('admin-9');
      expect(store?.clientMeta).toEqual({ ip: '10.0.0.1', userAgent: 'jest' });
    });
  });

  it('interceptor leaves anonymous requests untouched (no throw)', async () => {
    const interceptor = new RequestContextInterceptor();
    const next = { handle: jest.fn(() => 'ok' as never) } as never;
    const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) } as never;

    await runInRequest(() => {
      expect(() => interceptor.intercept(ctx, next)).not.toThrow();
      expect(getRequestContext()?.sessionUserId).toBeUndefined();
    });
  });
});

describe('AuthorizationService role memo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the DB on every call without a request context', async () => {
    userFindUnique.mockResolvedValue({ role: 'admin' });
    const authz = new AuthorizationService();

    expect(await authz.getFreshRoleRaw('u1')).toBe('admin');
    expect(await authz.getFreshRoleRaw('u1')).toBe('admin');
    expect(userFindUnique).toHaveBeenCalledTimes(2);
  });

  it('memoizes per (request, userId) inside a request context', async () => {
    userFindUnique.mockResolvedValue({ role: 'operator' });
    const authz = new AuthorizationService();

    await runInRequest(async () => {
      const roles = [
        await authz.getFreshRoleRaw('u1'),
        await authz.getFreshRoleRaw('u1'),
        await authz.getFreshRoleRaw('u2'),
      ];
      expect(roles).toEqual(['operator', 'operator', 'operator']);
      expect(userFindUnique).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to "user" on a missing row, inside and outside context', async () => {
    userFindUnique.mockResolvedValue(null);
    const authz = new AuthorizationService();
    expect(await authz.getFreshRoleRaw('ghost')).toBe('user');
  });
});
