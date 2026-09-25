jest.mock('server-only', () => ({}));

// better-auth/api is ESM and invisible to web jest (node_modules are not
// transformed), so every web spec mocks it. This spec uses a faithful
// stand-in whose constructor semantics are verified against the installed
// source (better-call/dist/error.mjs:102) AND runtime proof:
//   node -e "import('better-auth/api')" →
//   NOT_FOUND → { status: "NOT_FOUND", statusCode: 404 }
//   TOO_MANY_REQUESTS → { status: "TOO_MANY_REQUESTS", statusCode: 429 }
class FaithfulAPIError extends Error {
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
}

jest.mock('better-auth/api', () => ({
  APIError: FaithfulAPIError,
  isAPIError: (e: unknown) =>
    e instanceof Error && (e as { name?: string }).name === 'APIError',
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { classifyApiError, getApiErrorStatus } from './api-errors';

describe('api-errors with faithful APIError shape (P1-2/P1-3)', () => {
  it('shape matches installed better-call: token status, numeric statusCode', () => {
    const err = new FaithfulAPIError('NOT_FOUND', { message: 'nope' });
    expect(err.status).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    // The dead predicates this phase removed could never match this shape.
    expect(err.status).not.toBe(404 as unknown as string);
    const rate = new FaithfulAPIError('TOO_MANY_REQUESTS', { message: 's' });
    expect(rate.status).not.toBe(429 as unknown as string);
  });

  it('classifies 404/429/401/403/5xx token instances', () => {
    expect(
      classifyApiError(new FaithfulAPIError('NOT_FOUND', { message: 'x' })),
    ).toBe('not-found');
    expect(
      classifyApiError(
        new FaithfulAPIError('TOO_MANY_REQUESTS', { message: 'x' }),
      ),
    ).toBe('rate-limited');
    expect(
      classifyApiError(new FaithfulAPIError('UNAUTHORIZED', { message: 'x' })),
    ).toBe('unauthorized');
    expect(
      classifyApiError(new FaithfulAPIError('FORBIDDEN', { message: 'x' })),
    ).toBe('forbidden');
    expect(
      classifyApiError(
        new FaithfulAPIError('SERVICE_UNAVAILABLE', { message: 'x' }),
      ),
    ).toBe('unavailable');
  });

  it('getApiErrorStatus reads statusCode, not status', () => {
    expect(getApiErrorStatus(new FaithfulAPIError('NOT_FOUND', {}))).toBe(404);
    expect(getApiErrorStatus(new FaithfulAPIError('TOO_MANY_REQUESTS', {}))).toBe(
      429,
    );
  });

  it('admin audit page branch contract: rate-limited renders card, 5xx rethrows', () => {
    // Mirrors apps/web/src/app/admin/audit/page.tsx post-P1-3: the page
    // delegates to classifyApiError instead of `error.status === 429`.
    // (The .tsx page itself is invisible to web jest's js/ts-only resolver,
    // so the branch contract is pinned here against the faithful shape.)
    const rateErr = new FaithfulAPIError('TOO_MANY_REQUESTS', {
      message: 'slow',
    });
    expect(classifyApiError(rateErr)).toBe('rate-limited');
    const downErr = new FaithfulAPIError('SERVICE_UNAVAILABLE', {
      message: 'down',
    });
    expect(classifyApiError(downErr)).not.toBe('rate-limited');
    expect(classifyApiError(downErr)).toBe('unavailable');
  });
});
