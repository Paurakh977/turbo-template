import { jest } from '@jest/globals';

const noteFindUnique = jest.fn();
const noteUpdateMany = jest.fn();
const noteDeleteMany = jest.fn();
const auditCreate = jest.fn();
const userFindUnique = jest.fn();

jest.mock('@repo/database', () => ({
  db: {
    note: {
      findUnique: (...args: unknown[]) => noteFindUnique(...(args as [])),
      // Conditional bulk writes back the TOCTOU-safe update/remove paths.
      updateMany: (...args: unknown[]) => noteUpdateMany(...(args as [])),
      deleteMany: (...args: unknown[]) => noteDeleteMany(...(args as [])),
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
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { auth } from '@repo/auth';

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
    jest.resetAllMocks();
    service = new NotesService();
  });

  it('throws NotFound for a missing note', async () => {
    noteFindUnique.mockResolvedValue(null);
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });

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
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });

    await expect(
      service.update(makeSession({}), 'n1', {}, { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(noteFindUnique).not.toHaveBeenCalled();
    expect(noteUpdateMany).not.toHaveBeenCalled();
  });

  it("blocks editing someone else's note without an admin role", async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue(ownNote({ authorId: 'someone-else' }));
    userFindUnique.mockResolvedValue({ role: 'user' });

    await expect(
      service.update(
        makeSession({ userId: 'user-1' }),
        'n1',
        { title: 'x' },
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(noteUpdateMany).not.toHaveBeenCalled();
  });

  it('maps a lost update race to clean NotFound instead of a raw P2025', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    userFindUnique.mockResolvedValue({ role: 'user' });
    noteFindUnique.mockResolvedValue(ownNote());
    noteUpdateMany.mockResolvedValue({ count: 0 });

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

  it('answers from the pre-update row if a delete wins right after a committed write', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    userFindUnique.mockResolvedValue({ role: 'admin' });
    noteFindUnique
      .mockResolvedValueOnce(ownNote()) // ownership fetch
      .mockResolvedValueOnce(null); // post-write refetch loses the race
    noteUpdateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(
      makeSession({ userId: 'user-1' }),
      'n1',
      { title: 'renamed' },
      { ip: null, userAgent: null },
    );

    expect(result.title).toBe('renamed');
    // The UPDATE committed, so the audit row must exist even though the row
    // is gone by refetch time.
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('checks permissions against the EFFECTIVE (impersonating) admin id', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    const updated = ownNote({ title: 'new' });
    noteFindUnique.mockResolvedValue(updated);
    // The FRESH role is fetched for the effective id, not the impersonated user
    userFindUnique.mockResolvedValue({ role: 'admin' });
    noteUpdateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(
      makeSession({ userId: 'user-1', impersonatedBy: 'admin-9' }),
      'n1',
      { title: 'new' },
      { ip: '10.0.0.1', userAgent: 'ua' },
    );

    expect(result.title).toBe('new');
    expect(userHasPermissionMockCalls().userId).toBe('admin-9');
    expect(userFindUnique.mock.calls[0][0]).toEqual({
      where: { id: 'admin-9' },
      select: { role: true },
    });
  });

  function userHasPermissionMockCalls(): { userId: string } {
    return (auth.api.userHasPermission as jest.Mock).mock.calls[0][0].body;
  }
});

describe('NotesService.remove', () => {
  let service: NotesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NotesService();
  });

  it('audits with the pre-fetched title on success', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue({ title: 'doomed' });
    noteDeleteMany.mockResolvedValue({ count: 1 });

    await service.remove(makeSession({}), 'n1', { ip: '10.0.0.1', userAgent: 'ua' });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: 'note_deleted',
      metadata: { noteId: 'n1', title: 'doomed' },
    });
  });

  it('reports NotFound for a missing row without reaching the delete or audit', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue(null);

    await expect(
      service.remove(makeSession({}), 'gone', { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(noteDeleteMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('maps a lost delete race to clean NotFound without auditing a deletion that did not happen', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue({ title: 'raced' });
    noteDeleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.remove(makeSession({}), 'n1', { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
