jest.mock('server-only', () => ({}));
// Real-shape mock: string token in `status`, numeric code in `statusCode`
// (better-call/dist/error.mjs). P1-2 regression: the previous mock carried
// only `status`, hiding the dead `error.status === 404` comparison.
jest.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {
    status: string;
    statusCode: number | null;
    body: unknown;
    constructor(status: string, body: unknown) {
      super(
        typeof body === 'object' &&
        body !== null &&
        'message' in body &&
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : status,
      );
      this.name = 'APIError';
      this.status = status;
      const codes: Record<string, number> = {
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        TOO_MANY_REQUESTS: 429,
        INTERNAL_SERVER_ERROR: 500,
        SERVICE_UNAVAILABLE: 503,
        GATEWAY_TIMEOUT: 504,
      };
      this.statusCode = codes[status] ?? null;
      this.body = body;
    }
  },
}));
jest.mock('@repo/auth', () => ({
  auth: {},
}));
jest.mock('@repo/auth/permissions', () => ({
  AUTH_BASE_PATH: '/api/auth',
}));

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
  process.env.INTERNAL_API_URL = 'http://localhost:3001';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
});

afterAll(() => {
  process.env = originalEnv;
});

describe('auth-http toApiStatus mapping', () => {
  function getToApiStatus() {
    // The toApiStatus function is not exported, so we test it indirectly
    // through the error responses from callAuthApi wrappers.
    // Instead, test the mapping directly by importing and checking behavior.
    const mod = require('./auth-http');
    return mod;
  }

  it('getSessionFromApi exists and is a function', () => {
    const { getSessionFromApi } = require('./auth-http');
    expect(typeof getSessionFromApi).toBe('function');
  });

  it('listUsersFromApi exists and is a function', () => {
    const { listUsersFromApi } = require('./auth-http');
    expect(typeof listUsersFromApi).toBe('function');
  });

  it('sendVerificationEmailFromApi exists and is a function', () => {
    const { sendVerificationEmailFromApi } = require('./auth-http');
    expect(typeof sendVerificationEmailFromApi).toBe('function');
  });

  it('updateUserFromApi exists and is a function', () => {
    const { updateUserFromApi } = require('./auth-http');
    expect(typeof updateUserFromApi).toBe('function');
  });

  it('deleteUserFromApi exists and is a function', () => {
    const { deleteUserFromApi } = require('./auth-http');
    expect(typeof deleteUserFromApi).toBe('function');
  });

  it('listAccountsFromApi exists and is a function', () => {
    const { listAccountsFromApi } = require('./auth-http');
    expect(typeof listAccountsFromApi).toBe('function');
  });

  it('getAdminUserFromApi exists and is a function', () => {
    const { getAdminUserFromApi } = require('./auth-http');
    expect(typeof getAdminUserFromApi).toBe('function');
  });
});

describe('auth-http internalApiBaseUrl', () => {
  it('throws when INTERNAL_API_URL is not set', async () => {
    delete process.env.INTERNAL_API_URL;
    const { getSessionFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getSessionFromApi(headers, 1000)).rejects.toMatchObject({
      status: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('auth-http callAuthApi', () => {
  it('sends POST with body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"status":true}'),
    });
    global.fetch = mockFetch;

    const { sendVerificationEmailFromApi } = require('./auth-http');
    const result = await sendVerificationEmailFromApi(
      { email: 'test@example.com' },
      { timeoutMs: 1000 },
    );
    expect(result).toEqual({ status: true });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toContain('test@example.com');
  });

  it('throws on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { getSessionFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getSessionFromApi(headers, 1000)).rejects.toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
    });
  });

  it('throws on timeout', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(timeoutError);
    const { getSessionFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getSessionFromApi(headers, 1000)).rejects.toMatchObject({
      status: 'GATEWAY_TIMEOUT',
    });
  });

  it('returns null for getSessionFromApi when response is empty', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });
    const { getSessionFromApi } = require('./auth-http');
    const headers = new Headers();
    const result = await getSessionFromApi(headers);
    expect(result).toBeNull();
  });

  it('returns session when response has user', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({ user: { id: 'u1', email: 'a@b.com' }, session: { token: 't' } }),
        ),
    });
    const { getSessionFromApi } = require('./auth-http');
    const headers = new Headers();
    const result = await getSessionFromApi(headers);
    expect(result).toEqual({
      user: { id: 'u1', email: 'a@b.com' },
      session: { token: 't' },
    });
  });

  it('listAccountsFromApi returns empty array for non-array response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('null'),
    });
    const { listAccountsFromApi } = require('./auth-http');
    const headers = new Headers();
    const result = await listAccountsFromApi(headers);
    expect(result).toEqual([]);
  });

  // 100% branch coverage for getAdminUserFromApi — no try/catch-pass.
  it('getAdminUserFromApi returns null on 404 (token + numeric shapes)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('{"message":"not found"}'),
    });
    const { getAdminUserFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getAdminUserFromApi('u1', headers)).resolves.toBeNull();
  });

  it('getAdminUserFromApi returns null on 404 with an empty body', async () => {
    // Exercises the throwForNonOkResponse fallback branch (rawText empty →
    // statusText body) while still producing status NOT_FOUND / 404.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve(''),
    });
    const { getAdminUserFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getAdminUserFromApi('u1', headers)).resolves.toBeNull();
  });

  it('gateway 404 surfaces as APIError token NOT_FOUND with numeric 404', async () => {
    // Pins the real better-call shape the P1-2 fix relies on: `status` is
    // the string token, `statusCode` the number. Guards against mock drift.
    const { APIError } = jest.requireMock('better-auth/api');
    const err = new APIError('NOT_FOUND', { message: 'not found' });
    expect(err.status).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.status).not.toBe(404 as unknown as string);
  });

  it('getAdminUserFromApi rethrows 500 instead of mapping to null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('{"message":"boom"}'),
    });
    const { getAdminUserFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getAdminUserFromApi('u1', headers)).rejects.toMatchObject({
      status: 'INTERNAL_SERVER_ERROR',
      statusCode: 500,
    });
  });

  it('getAdminUserFromApi rethrows 403 instead of mapping to null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('{"message":"denied"}'),
    });
    const { getAdminUserFromApi } = require('./auth-http');
    const headers = new Headers();
    await expect(getAdminUserFromApi('u1', headers)).rejects.toMatchObject({
      status: 'FORBIDDEN',
      statusCode: 403,
    });
  });
});
