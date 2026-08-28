import { getImpersonatedBy, getEffectiveUserId } from './session.utils';

function makeSession(overrides: {
  userId?: string;
  impersonatedBy?: string | null;
} = {}) {
  return {
    user: { id: overrides.userId ?? 'user-1', name: 'Test' },
    session: { impersonatedBy: overrides.impersonatedBy ?? null, id: 'sess-1' },
  } as Parameters<typeof getImpersonatedBy>[0];
}

describe('getImpersonatedBy', () => {
  it('returns the impersonatedBy value when present', () => {
    const session = makeSession({ impersonatedBy: 'admin-9' });
    expect(getImpersonatedBy(session)).toBe('admin-9');
  });

  it('returns null when not impersonating', () => {
    const session = makeSession({ impersonatedBy: null });
    expect(getImpersonatedBy(session)).toBeNull();
  });

  it('returns null when session object is missing impersonatedBy', () => {
    const session = {
      user: { id: 'u1' },
      session: { id: 's1' },
    } as unknown as Parameters<typeof getImpersonatedBy>[0];
    expect(getImpersonatedBy(session)).toBeNull();
  });

  it('returns null when session property is undefined', () => {
    const session = {
      user: { id: 'u1' },
    } as unknown as Parameters<typeof getImpersonatedBy>[0];
    expect(getImpersonatedBy(session)).toBeNull();
  });
});

describe('getEffectiveUserId', () => {
  it('returns the impersonating admin id when impersonating', () => {
    const session = makeSession({
      userId: 'impersonated-user',
      impersonatedBy: 'admin-9',
    });
    expect(getEffectiveUserId(session)).toBe('admin-9');
  });

  it('returns the user id when not impersonating', () => {
    const session = makeSession({ userId: 'user-1', impersonatedBy: null });
    expect(getEffectiveUserId(session)).toBe('user-1');
  });

  it('returns the user id when impersonatedBy is undefined', () => {
    const session = {
      user: { id: 'user-1' },
      session: { id: 's1' },
    } as unknown as Parameters<typeof getEffectiveUserId>[0];
    expect(getEffectiveUserId(session)).toBe('user-1');
  });
});
