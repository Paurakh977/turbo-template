jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}));

import { inferOriginFromHeaders, getAppBaseUrl } from './app-url';

describe('inferOriginFromHeaders', () => {
  it('returns null when no host header', () => {
    const headers = new Headers();
    expect(inferOriginFromHeaders(headers)).toBeNull();
  });

  it('infers http for localhost', () => {
    const headers = new Headers();
    headers.set('host', 'localhost:3000');
    expect(inferOriginFromHeaders(headers)).toBe('http://localhost:3000');
  });

  it('infers https for non-localhost host', () => {
    const headers = new Headers();
    headers.set('host', 'example.com');
    expect(inferOriginFromHeaders(headers)).toBe('https://example.com');
  });

  it('uses x-forwarded-proto', () => {
    const headers = new Headers();
    headers.set('host', 'example.com');
    headers.set('x-forwarded-proto', 'https');
    expect(inferOriginFromHeaders(headers)).toBe('https://example.com');
  });

  it('uses x-forwarded-host', () => {
    const headers = new Headers();
    headers.set('host', 'internal:3000');
    headers.set('x-forwarded-host', 'app.example.com');
    expect(inferOriginFromHeaders(headers)).toBe(
      'https://app.example.com',
    );
  });

  it('uses first value from comma-separated x-forwarded-host', () => {
    const headers = new Headers();
    headers.set('host', 'internal:3000');
    headers.set('x-forwarded-host', 'app.example.com, proxy.internal');
    expect(inferOriginFromHeaders(headers)).toBe(
      'https://app.example.com',
    );
  });

  it('infers http for 127.0.0.1', () => {
    const headers = new Headers();
    headers.set('host', '127.0.0.1:3000');
    expect(inferOriginFromHeaders(headers)).toBe('http://127.0.0.1:3000');
  });
});

describe('getAppBaseUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses NEXT_PUBLIC_APP_URL when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    const { getAppBaseUrl } = require('./app-url');
    const result = await getAppBaseUrl();
    expect(result).toBe('https://app.example.com');
  });

  it('strips trailing slash from NEXT_PUBLIC_APP_URL', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';
    const { getAppBaseUrl } = require('./app-url');
    const result = await getAppBaseUrl();
    expect(result).toBe('https://app.example.com');
  });

  it('infers from headers when NEXT_PUBLIC_APP_URL is not set', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { getAppBaseUrl } = require('./app-url');
    const headers = new Headers();
    headers.set('host', 'myapp.com');
    const result = await getAppBaseUrl(headers);
    expect(result).toBe('https://myapp.com');
  });

  it('falls back to getPublicAppBaseUrl when no headers', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { getAppBaseUrl } = require('./app-url');
    const result = await getAppBaseUrl(new Headers());
    // Falls back to BETTER_AUTH_URL or localhost
    expect(result).toBeTruthy();
  });
});
