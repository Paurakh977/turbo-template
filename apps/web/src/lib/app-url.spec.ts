import {
  trimTrailingSlash,
  buildAbsoluteUrl,
  getPublicAppBaseUrl,
  getClientAppBaseUrl,
} from '../lib/app-url';

describe('trimTrailingSlash', () => {
  it('removes trailing slash', () => {
    expect(trimTrailingSlash('https://example.com/')).toBe(
      'https://example.com',
    );
  });

  it('returns unchanged when no trailing slash', () => {
    expect(trimTrailingSlash('https://example.com')).toBe(
      'https://example.com',
    );
  });

  it('does not remove slash in the middle', () => {
    expect(trimTrailingSlash('https://example.com/path/')).toBe(
      'https://example.com/path',
    );
  });

  it('handles root path only', () => {
    expect(trimTrailingSlash('/')).toBe('');
  });
});

describe('buildAbsoluteUrl', () => {
  it('combines base and pathname', () => {
    expect(buildAbsoluteUrl('https://example.com', '/dashboard')).toBe(
      'https://example.com/dashboard',
    );
  });

  it('handles base without trailing slash', () => {
    expect(buildAbsoluteUrl('https://example.com', '/path')).toBe(
      'https://example.com/path',
    );
  });

  it('handles base with trailing slash', () => {
    expect(buildAbsoluteUrl('https://example.com/', '/path')).toBe(
      'https://example.com/path',
    );
  });

  it('adds leading slash to pathname if missing', () => {
    expect(buildAbsoluteUrl('https://example.com', 'path')).toBe(
      'https://example.com/path',
    );
  });

  it('handles nested paths', () => {
    expect(buildAbsoluteUrl('https://example.com', '/a/b/c')).toBe(
      'https://example.com/a/b/c',
    );
  });
});

describe('getPublicAppBaseUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses NEXT_PUBLIC_APP_URL when set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    const mod = require('../lib/app-url');
    expect(mod.getPublicAppBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to BETTER_AUTH_URL', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.BETTER_AUTH_URL = 'https://auth.example.com';
    const mod = require('../lib/app-url');
    expect(mod.getPublicAppBaseUrl()).toBe('https://auth.example.com');
  });

  it('falls back to localhost', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    const mod = require('../lib/app-url');
    expect(mod.getPublicAppBaseUrl()).toBe('http://localhost:3000');
  });

  it('trims trailing slash from NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';
    const mod = require('../lib/app-url');
    expect(mod.getPublicAppBaseUrl()).toBe('https://app.example.com');
  });
});
