jest.mock('./infra/redis', () => ({
  redis: null,
}));

jest.mock('@repo/database', () => ({
  db: {
    auditLog: { create: jest.fn() },
    session: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn() },
    account: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

// Real-shape APIError: string token in `status`, numeric in `statusCode`
// (better-call/dist/error.mjs). isAPIError mirrors @better-auth/core.
jest.mock('better-auth/api', () => ({
  createAuthMiddleware: (fn: Function) => fn,
  getSessionFromCtx: jest.fn(),
  APIError: class APIError extends Error {
    status: string;
    statusCode: number | null;
    body: unknown;
    constructor(status: string, body: unknown) {
      super((body as { message?: string })?.message ?? status);
      this.name = 'APIError';
      this.status = status;
      const codes: Record<string, number> = {
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        TOO_MANY_REQUESTS: 429,
        INTERNAL_SERVER_ERROR: 500,
      };
      this.statusCode = codes[status] ?? null;
      this.body = body;
    }
  },
  isAPIError: (e: unknown) =>
    e instanceof Error && (e as { name?: string }).name === 'APIError',
}));

jest.mock('../shared/client-ip', () => ({
  resolveClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));

import { getSessionFromCtx } from 'better-auth/api';
import { db } from '@repo/database';
import { auditLogPlugin } from './audit-plugin';
import { databaseHooks } from './database-hooks';
import { popPendingStopImpersonation } from './pending-storage';

const auditCreate = db.auditLog.create as jest.Mock;

function hookFor(
  hooks: Array<{ matcher: (ctx: unknown) => boolean; handler: Function }>,
  path: string,
): Function {
  const probe = { path } as unknown;
  const found = hooks.find((h) => {
    try {
      return h.matcher(probe);
    } catch {
      return false;
    }
  });
  if (!found) throw new Error(`no hook registered for ${path}`);
  return found.handler;
}

// Impersonated session as seen by hooks: request user = impersonated user,
// session row carries impersonatedBy = admin id.
const IMPERSONATED_CTX_SESSION = {
  user: { id: 'user-impersonated' },
  session: { impersonatedBy: 'admin-1', token: 'tok-imp' },
};

const DB_IMPERSONATED_ROW = {
  userId: 'user-impersonated',
  impersonatedBy: 'admin-1',
  ipAddress: null,
  userAgent: null,
};

function ctxWithHeaders(returned: unknown) {
  const headers = new Headers();
  return { path: '/admin/stop-impersonating', headers, context: { returned } };
}

describe('stop-impersonation audit exactly-once (P1-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditCreate.mockResolvedValue({});
    (getSessionFromCtx as jest.Mock).mockResolvedValue(
      IMPERSONATED_CTX_SESSION,
    );
  });

  it('successful stop writes exactly one user_stop_impersonating row', async () => {
    const plugin = auditLogPlugin();
    const beforeStop = hookFor(
      plugin.hooks!.before as never,
      '/admin/stop-impersonating',
    );
    const afterStop = hookFor(
      plugin.hooks!.after as never,
      '/admin/stop-impersonating',
    );

    // T1: plugin before hook stores suppression (must run before endpoint).
    await beforeStop(ctxWithHeaders(undefined));

    // T2: endpoint deletes the session → session.delete.before fires DURING
    // the endpoint and must consume the flag instead of auditing.
    await (
      databaseHooks.session.delete.before as Function
    )(DB_IMPERSONATED_ROW, { headers: new Headers() });
    const writesAfterDeleteBefore = auditCreate.mock.calls.filter(
      (c) => c[0]?.data?.action === 'user_stop_impersonating',
    );
    expect(writesAfterDeleteBefore).toHaveLength(0);

    // T3: plugin after hook (success) writes the single authoritative row.
    await afterStop(ctxWithHeaders({ ok: true }));

    const stopRows = auditCreate.mock.calls.filter(
      (c) => c[0]?.data?.action === 'user_stop_impersonating',
    );
    expect(stopRows).toHaveLength(1);
    expect(stopRows[0][0].data).toMatchObject({
      userId: 'user-impersonated',
      actor: 'admin-1',
    });
  });

  it('failed stop writes zero rows and clears the stale flag', async () => {
    const { APIError } = jest.requireMock('better-auth/api');
    const plugin = auditLogPlugin();
    const beforeStop = hookFor(
      plugin.hooks!.before as never,
      '/admin/stop-impersonating',
    );
    const afterStop = hookFor(
      plugin.hooks!.after as never,
      '/admin/stop-impersonating',
    );

    await beforeStop(ctxWithHeaders(undefined));
    // Endpoint failed before deleteSession(): no delete.before runs.
    await afterStop(
      ctxWithHeaders(new APIError('INTERNAL_SERVER_ERROR', {})),
    );

    expect(auditCreate).not.toHaveBeenCalled();
    // Flag must not leak into a later legitimate sign-out audit window.
    await expect(
      popPendingStopImpersonation('user-impersonated'),
    ).resolves.toBe(false);
  });

  it('plain sign-out still audits user_signed_out (no suppression leak)', async () => {
    await (
      databaseHooks.session.delete.before as Function
    )({ userId: 'user-plain', impersonatedBy: null }, { headers: new Headers() });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('user_signed_out');
  });

  it('registers a before hook for /admin/stop-impersonating (ordering contract)', () => {
    const plugin = auditLogPlugin();
    expect(() =>
      hookFor(plugin.hooks!.before as never, '/admin/stop-impersonating'),
    ).not.toThrow();
  });
});
