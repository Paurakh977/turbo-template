jest.mock('server-only', () => ({}));
jest.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {
    statusCode: number | null = null;
    status: number | null = null;
    constructor(status: string, body: unknown) {
      super(status);
      this.status = status as unknown as number;
      this.statusCode = status as unknown as number;
    }
  },
  isAPIError: (e: unknown) => e instanceof Error && 'status' in (e as object),
}));
jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
  notFound: jest.fn(),
}));

describe('api-errors central classifier (Phase 6)', () => {
  const {
    classifyApiError,
    getApiErrorStatus,
    toActionErrorMessage,
    toActionError,
    throwUnlessAuth,
  } = require('./api-errors');

  it('classifies 401/404/429/5xx distinctly', () => {
    expect(classifyApiError({ status: 401 })).toBe('unauthorized');
    expect(classifyApiError({ status: 404 })).toBe('not-found');
    expect(classifyApiError({ status: 429 })).toBe('rate-limited');
    expect(classifyApiError({ status: 503 })).toBe('unavailable');
  });

  it('treats timeout/fetch-failure messages as unavailable, not unknown', () => {
    expect(classifyApiError(new Error('fetch failed'))).toBe('unavailable');
    expect(classifyApiError(new Error('The operation timed out'))).toBe(
      'unavailable',
    );
  });

  it('toActionErrorMessage maps status to user-safe strings', () => {
    expect(toActionErrorMessage({ status: 401 }, 'fallback')).toMatch(
      /session expired/i,
    );
    expect(toActionErrorMessage({ status: 403 }, 'fallback')).toMatch(
      /not allowed/i,
    );
    expect(toActionErrorMessage({ status: 429 }, 'fallback')).toMatch(
      /too many requests/i,
    );
    expect(
      toActionErrorMessage({ status: 400, message: 'bad input' }, 'fallback'),
    ).toBe('bad input');
    expect(toActionErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(toActionErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('toActionError shapes { error } for actions', () => {
    expect(toActionError({ status: 429 }, 'fb')).toEqual({
      error: expect.stringMatching(/too many requests/i),
    });
  });

  it('getApiErrorStatus returns null for unshaped throws', () => {
    expect(getApiErrorStatus(new Error('x'))).toBeNull();
    expect(getApiErrorStatus({ status: 401 })).toBe(401);
  });

  it('throwUnlessAuth redirects only on 401', () => {
    const { redirect, notFound } = require('next/navigation');
    redirect.mockClear();
    notFound.mockClear();
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    expect(() => throwUnlessAuth({ status: 401 })).toThrow('NEXT_REDIRECT');
    expect(() => throwUnlessAuth({ status: 404 })).toThrow('NEXT_NOT_FOUND');
    expect(() => throwUnlessAuth({ status: 503 })).toThrow();
  });
});
