import { jest } from '@jest/globals';

const noteFindUnique = jest.fn();
const noteCreate = jest.fn();
const noteUpdate = jest.fn();
const noteDelete = jest.fn();
const auditCreate = jest.fn();
const userFindUnique = jest.fn();

// NotesService wraps the atomic write + outbox enqueue in
// db.$transaction (interactive form). The mock runs the callback against a tx
// client wired to the same jest.fn()s so assertions stay unchanged; with no
// queue injected the service keeps the synchronous auditLog.create fallback.
jest.mock('@repo/database', () => ({
  db: {
    note: {
      findUnique: (...args: unknown[]) => noteFindUnique(...(args as [])),
      create: (...args: unknown[]) => noteCreate(...(args as [])),
      // Atomic single-row writes back the TOCTOU-safe update/remove paths:
      // a row deleted mid-flight throws P2025 instead of returning a count.
      update: (...args: unknown[]) => noteUpdate(...(args as [])),
      delete: (...args: unknown[]) => noteDelete(...(args as [])),
    },
    $transaction: (...args: unknown[]) => {
      const first = args[0] as ((tx: unknown) => unknown) | unknown[];
      if (typeof first === 'function') {
        return first({
          note: {
            findUnique: (...a: unknown[]) => noteFindUnique(...(a as [])),
            create: (...a: unknown[]) => noteCreate(...(a as [])),
            update: (...a: unknown[]) => noteUpdate(...(a as [])),
            delete: (...a: unknown[]) => noteDelete(...(a as [])),
          },
        });
      }
      return Promise.resolve([]);
    },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...(args as [])) },
    auditLog: { create: (...args: unknown[]) => auditCreate(...(args as [])) },
  },
}));

jest.mock('@repo/auth', () => ({
  auth: {
    api: {
      userHasPermission: jest.fn(),
    },
  },
  // Local evaluation (Tasks 2-3) uses the same AccessControl objects the
  // service imports. Minimal real semantics: user has no notes perms,
  // operator/admin have list/create/update, superAdmin adds delete.
  ADMIN_PLUGIN_ROLES: {
    user: { authorize: () => ({ success: false }) },
    operator: {
      authorize: (perm: Record<string, string[]>) =>
        perm.notes?.includes('delete') ? { success: false } : { success: true },
    },
    admin: {
      authorize: (perm: Record<string, string[]>) =>
        perm.notes?.includes('delete') ? { success: false } : { success: true },
    },
    superAdmin: { authorize: () => ({ success: true }) },
  },
  statement: {
    notes: ['create', 'list', 'update', 'delete'],
    settings: ['read', 'profile', 'security', 'theme', 'labs'],
  },
}));

jest.mock('@repo/observability', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  withSpan: jest.fn((_name: string, fn: (span: { setAttribute: jest.Mock; setStatus: jest.Mock; recordException: jest.Mock }) => unknown) => {
    const mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
    };
    return fn(mockSpan);
  }),
  AppAttributes: {
    OPERATION: 'app.operation',
    ENTITY_TYPE: 'app.entity_type',
    ENTITY_ID: 'app.entity_id',
    FEATURE: 'app.feature',
  },
}));

const mockMetricsService = {
  recordHttpRequest: jest.fn(),
  recordHttpError: jest.fn(),
  recordAuthEvent: jest.fn(),
  recordRateLimitHit: jest.fn(),
  recordNoteOperation: jest.fn(),
};

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { AuthorizationService } from '../common/authorization.service';

type SessionFixture = Parameters<NotesService['update']>[0];

function makeSession(opts: {
  userId?: string;
  impersonatedBy?: string | null;
}): SessionFixture {
  return {
    user: { id: opts.userId ?? 'user-1' },
    session: { impersonatedBy: opts.impersonatedBy ?? null },
  } as unknown as SessionFixture;
}

function ownNote(overrides: Partial<{ authorId: string; title: string }> = {}) {
  return {
    id: 'n1',
    title: overrides.title ?? 't',
    content: 'c',
    authorId: overrides.authorId ?? 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    author: { id: overrides.authorId ?? 'user-1', name: null },
  };
}

describe('NotesService.update authorization', () => {
  let service: NotesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotesService(
      mockMetricsService as never,
      new AuthorizationService(),
    );
  });

  it('throws NotFound for a missing note', async () => {
    noteFindUnique.mockResolvedValue(null);
    // operator holds update — reaches the note lookup (was userHasPermission).
    userFindUnique.mockResolvedValue({ role: 'operator' });

    await expect(
      service.update(
        makeSession({}),
        'missing',
        { title: 'x' }, // non-empty patch: empty patches are rejected earlier
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an empty patch without touching the DB or writing an audit row', async () => {
    userFindUnique.mockResolvedValue({ role: 'operator' });

    await expect(
      service.update(makeSession({}), 'n1', {}, { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(noteFindUnique).not.toHaveBeenCalled();
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it("blocks editing someone else's note without an admin role", async () => {
    // operator passes the permission gate but fails the ownership/admin gate.
    userFindUnique.mockResolvedValue({ role: 'operator' });
    noteFindUnique.mockResolvedValue(ownNote({ authorId: 'someone-else' }));

    await expect(
      service.update(
        makeSession({ userId: 'user-1' }),
        'n1',
        { title: 'x' },
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('maps a lost update race to clean NotFound instead of a raw P2025', async () => {
    userFindUnique.mockResolvedValue({ role: 'operator' });
    noteFindUnique.mockResolvedValue(ownNote());
    noteUpdate.mockRejectedValue({ code: 'P2025' });

    await expect(
      service.update(
        makeSession({ userId: 'user-1' }),
        'n1',
        { title: 'x' },
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Lost race: nothing was updated, so no audit row either.
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns the updated row straight from the atomic write (no refetch)', async () => {
    userFindUnique.mockResolvedValue({ role: 'admin' });
    noteFindUnique.mockResolvedValue(ownNote()); // ownership fetch only
    noteUpdate.mockResolvedValue(ownNote({ title: 'renamed' }));

    const result = await service.update(
      makeSession({ userId: 'user-1' }),
      'n1',
      { title: 'renamed' },
      { ip: null, userAgent: null },
    );

    expect(result.title).toBe('renamed');
    // One ownership read + one write: the write itself returns the row.
    expect(noteFindUnique).toHaveBeenCalledTimes(1);
    expect(noteUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('checks permissions against the EFFECTIVE (impersonating) admin id', async () => {
    const updated = ownNote({ title: 'new' });
    noteFindUnique.mockResolvedValue(updated);
    // The FRESH role is fetched for the effective id, not the impersonated user
    userFindUnique.mockResolvedValue({ role: 'admin' });
    noteUpdate.mockResolvedValue(updated);

    const result = await service.update(
      makeSession({ userId: 'user-1', impersonatedBy: 'admin-9' }),
      'n1',
      { title: 'new' },
      { ip: '10.0.0.1', userAgent: 'ua' },
    );

    expect(result.title).toBe('new');
    expect(userFindUnique.mock.calls[0][0]).toEqual({
      where: { id: 'admin-9' },
      select: { role: true },
    });
  });
});

describe('NotesService.remove', () => {
  let service: NotesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotesService(
      mockMetricsService as never,
      new AuthorizationService(),
    );
  });

  it('audits with the title returned by the atomic delete on success', async () => {
    // delete requires superAdmin under local evaluation.
    userFindUnique.mockResolvedValue({ role: 'superAdmin' });
    noteDelete.mockResolvedValue({ title: 'doomed' });

    await service.remove(makeSession({}), 'n1', { ip: '10.0.0.1', userAgent: 'ua' });

    expect(noteFindUnique).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: 'note_deleted',
      metadata: { noteId: 'n1', title: 'doomed' },
    });
  });

  it('reports NotFound for a missing row without writing an audit', async () => {
    userFindUnique.mockResolvedValue({ role: 'superAdmin' });
    noteDelete.mockRejectedValue({ code: 'P2025' });

    await expect(
      service.remove(makeSession({}), 'gone', { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('maps a lost delete race to clean NotFound without auditing a deletion that did not happen', async () => {
    userFindUnique.mockResolvedValue({ role: 'superAdmin' });
    noteDelete.mockRejectedValue({ code: 'P2025' });

    await expect(
      service.remove(makeSession({}), 'n1', { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
