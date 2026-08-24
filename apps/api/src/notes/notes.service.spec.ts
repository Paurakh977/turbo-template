import { jest } from '@jest/globals';

const noteFindUnique = jest.fn();
const noteUpdate = jest.fn();
const userFindUnique = jest.fn();

jest.mock('@repo/database', () => ({
  db: {
    note: {
      findUnique: (...args: unknown[]) => noteFindUnique(...(args as [])),
      update: (...args: unknown[]) => noteUpdate(...(args as [])),
    },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...(args as [])) },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock('@repo/auth', () => ({
  auth: {
    api: {
      userHasPermission: jest.fn(),
    },
  },
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
      service.update(makeSession({}), 'missing', {}, { ip: null, userAgent: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("blocks editing someone else's note without an admin role", async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue({
      id: 'n1',
      title: 't',
      content: 'c',
      authorId: 'someone-else',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userFindUnique.mockResolvedValue({ role: 'user' });

    await expect(
      service.update(
        makeSession({ userId: 'user-1' }),
        'n1',
        { title: 'x' },
        { ip: null, userAgent: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks permissions against the EFFECTIVE (impersonating) admin id', async () => {
    (auth.api.userHasPermission as jest.Mock).mockResolvedValue({ success: true });
    noteFindUnique.mockResolvedValue({
      id: 'n1',
      title: 't',
      content: 'c',
      authorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // The FRESH role is fetched for the effective id, not the impersonated user
    userFindUnique.mockResolvedValue({ role: 'admin' });
    noteUpdate.mockResolvedValue({
      id: 'n1',
      title: 'new',
      content: 'c',
      authorId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      author: { id: 'user-1', name: null },
    });

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
