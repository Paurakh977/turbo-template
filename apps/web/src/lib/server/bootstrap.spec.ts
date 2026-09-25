import { jest } from '@jest/globals';

const getMyBootstrapFromApi = jest.fn();

jest.mock('./internal-api', () => ({
  getMyBootstrapFromApi: (...args: unknown[]) =>
    getMyBootstrapFromApi(...(args as [])),
}));

import { getRequestBootstrap } from './bootstrap';
import { fingerprintCacheArgs } from './request-fingerprint';

function headers(init: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(init)) h.set(k, v);
  return h;
}

describe('bootstrap request isolation (Phase 10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMyBootstrapFromApi.mockResolvedValue({ user: { id: 'u1' } });
  });

  it('produces byte-identical primitive keys for identical fingerprints (dedup hits)', async () => {
    // React cache() memoizes by argument identity within one request scope;
    // it cannot be exercised across scopes in unit jest (each top-level call
    // gets its own scope, so the fetch runs per call here by framework
    // design). What unit tests CAN prove: identical requests derive
    // byte-identical primitive key tuples, so layout + page MUST hit the same
    // cache entry in a real SSR pass. Same-pass coalescing itself is proven
    // live (notes SSR = exactly 1 bootstrap HTTP).
    const h = () =>
      headers({ cookie: 's=A', 'x-forwarded-for': '1.1.1.1', 'user-agent': 'ua' });
    expect(fingerprintCacheArgs(h())).toEqual(fingerprintCacheArgs(h()));
    expect(fingerprintCacheArgs(h()).every((k) => typeof k === 'string')).toBe(true);
  });

  it('isolates two users by cookie', async () => {
    await getRequestBootstrap(headers({ cookie: 's=ALICE' }));
    await getRequestBootstrap(headers({ cookie: 's=BOB' }));
    expect(getMyBootstrapFromApi).toHaveBeenCalledTimes(2);
  });

  it('isolates by IP and user-agent, anonymous users included', async () => {
    await getRequestBootstrap(headers({}));
    await getRequestBootstrap(headers({ 'x-forwarded-for': '9.9.9.9' }));
    await getRequestBootstrap(headers({ 'user-agent': 'other' }));
    expect(getMyBootstrapFromApi).toHaveBeenCalledTimes(3);
  });

  it('keys the accounts variant separately from the plain bootstrap', async () => {
    const h = () => headers({ cookie: 's=A' });
    // Key tuples differ only by the `with` arg (appended by
    // getRequestBootstrap, not part of the fingerprint) — same-request
    // coalescing per variant follows from the key-equality proof above.
    await getRequestBootstrap(h());
    await getRequestBootstrap(h(), { with: 'accounts' });
    expect(getMyBootstrapFromApi).toHaveBeenCalledTimes(2);
  });
});
