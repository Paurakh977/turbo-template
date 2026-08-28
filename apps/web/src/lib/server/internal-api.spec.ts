jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}));
jest.mock('better-auth/api', () => ({
  APIError: class APIError extends Error {
    status: string;
    body: unknown;
    constructor(status: string, body: unknown) {
      super(status);
      this.status = status;
      this.body = body;
    }
  },
}));

// Test the toApiStatus helper and callInternalApi indirectly via the exported
// functions. We need to test callInternalApi which is not directly exported,
// so we test through getMyPermissionsFromApi and the toApiStatus pattern.

describe('internal-api module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('internalApiBaseUrl behavior', () => {
    it('throws when INTERNAL_API_URL is not set', async () => {
      delete process.env.INTERNAL_API_URL;
      const { callInternalApi } = require('./internal-api');
      await expect(
        callInternalApi('/test', { timeoutMs: 1000 }),
      ).rejects.toMatchObject({ status: 'INTERNAL_SERVER_ERROR' });
    });

    it('strips trailing slashes from INTERNAL_API_URL', async () => {
      process.env.INTERNAL_API_URL = 'http://localhost:3001///';
      const { callInternalApi } = require('./internal-api');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
      });
      global.fetch = mockFetch;

      await callInternalApi('/test');
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl.toString()).toBe('http://localhost:3001/test');
    });
  });

  describe('callInternalApi', () => {
    beforeEach(() => {
      process.env.INTERNAL_API_URL = 'http://localhost:3001';
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    });

    it('sends GET request with correct headers', async () => {
      const { callInternalApi } = require('./internal-api');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"result":"ok"}'),
      });
      global.fetch = mockFetch;

      const result = await callInternalApi('/api/test');
      expect(result).toEqual({ result: 'ok' });
      expect(mockFetch).toHaveBeenCalled();
      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('GET');
    });

    it('sends POST with body', async () => {
      const { callInternalApi } = require('./internal-api');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"created":true}'),
      });
      global.fetch = mockFetch;

      await callInternalApi('/api/create', {
        method: 'POST',
        body: { name: 'test' },
      });
      const [, init] = mockFetch.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"name":"test"}');
    });

    it('throws SERVICE_UNAVAILABLE on network error', async () => {
      const { callInternalApi } = require('./internal-api');
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        callInternalApi('/api/test', { timeoutMs: 1000 }),
      ).rejects.toMatchObject({ status: 'SERVICE_UNAVAILABLE' });
    });

    it('throws GATEWAY_TIMEOUT on timeout', async () => {
      const { callInternalApi } = require('./internal-api');
      const timeoutError = new Error('aborted');
      timeoutError.name = 'AbortError';
      global.fetch = jest.fn().mockRejectedValue(timeoutError);

      await expect(
        callInternalApi('/api/test', { timeoutMs: 1000 }),
      ).rejects.toMatchObject({ status: 'GATEWAY_TIMEOUT' });
    });

    it('throws on non-2xx response', async () => {
      const { callInternalApi } = require('./internal-api');
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve('{"message":"not found"}'),
      });

      await expect(
        callInternalApi('/api/missing'),
      ).rejects.toMatchObject({ status: 'NOT_FOUND' });
    });

    it('returns undefined for 204 No Content', async () => {
      const { callInternalApi } = require('./internal-api');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      });

      const result = await callInternalApi('/api/delete', {
        method: 'DELETE',
      });
      expect(result).toBeUndefined();
    });

    it('passes query params to URL', async () => {
      const { callInternalApi } = require('./internal-api');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('[]'),
      });
      global.fetch = mockFetch;

      await callInternalApi('/api/list', {
        query: { page: 1, limit: 10 },
      });
      const calledUrl = mockFetch.mock.calls[0][0] as URL;
      expect(calledUrl.searchParams.get('page')).toBe('1');
      expect(calledUrl.searchParams.get('limit')).toBe('10');
    });

    it('forwards cookie and user-agent headers', async () => {
      const { callInternalApi } = require('./internal-api');
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{}'),
      });
      global.fetch = mockFetch;

      const headers = new Headers();
      headers.set('cookie', 'session=abc123');
      headers.set('user-agent', 'TestAgent/1.0');
      headers.set('x-forwarded-for', '1.2.3.4');

      await callInternalApi('/api/test', { requestHeaders: headers });
      const [, init] = mockFetch.mock.calls[0];
      const sentHeaders = init.headers as Headers;
      expect(sentHeaders.get('cookie')).toBe('session=abc123');
      expect(sentHeaders.get('user-agent')).toBe('TestAgent/1.0');
      expect(sentHeaders.get('x-forwarded-for')).toBe('1.2.3.4');
    });
  });
});
