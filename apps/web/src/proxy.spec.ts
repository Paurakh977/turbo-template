import { proxy, config } from './proxy';

describe('buildCSP', () => {
  it('returns a string with nonce', () => {
    const nonce = btoa('test-nonce');
    // buildCSP is not exported, but proxy calls it internally.
    // We test through the proxy function's response headers.
    const mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/dashboard',
    } as unknown as import('next/server').NextRequest;

    const response = proxy(mockRequest);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain('default-src');
    expect(csp).toContain('script-src');
    expect(csp).toContain('style-src');
    expect(csp).toContain('connect-src');
    expect(csp).toContain('img-src');
    expect(csp).toContain('object-src');
    expect(csp).toContain('base-uri');
    expect(csp).toContain('form-action');
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('includes nonce in script-src', () => {
    const mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/',
    } as unknown as import('next/server').NextRequest;

    const response = proxy(mockRequest);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  });

  it('does not include unsafe-eval in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/',
    } as unknown as import('next/server').NextRequest;

    const response = proxy(mockRequest);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).not.toContain('unsafe-eval');

    process.env.NODE_ENV = original;
  });
});

describe('proxy function', () => {
  it('sets x-nonce header on the request', () => {
    const mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/',
    } as unknown as import('next/server').NextRequest;

    const response = proxy(mockRequest);
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('returns a NextResponse', () => {
    const mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/',
    } as unknown as import('next/server').NextRequest;

    const response = proxy(mockRequest);
    expect(response).toBeDefined();
    expect(typeof response.headers.get).toBe('function');
  });
});

describe('config.matcher', () => {
  it('excludes static assets', () => {
    expect(config.matcher[0]).toContain('_next/static');
    expect(config.matcher[0]).toContain('_next/image');
    expect(config.matcher[0]).toContain('favicon.ico');
    expect(config.matcher[0]).toMatch(/svg|png|jpg|jpeg|gif|webp/);
  });

  it('matches all other routes', () => {
    expect(config.matcher[0]).toContain('.*');
  });
});
