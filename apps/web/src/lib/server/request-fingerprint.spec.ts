jest.mock('server-only', () => ({}));
jest.mock('react', () => ({ cache: (fn) => fn }));

describe('request-fingerprint (Phase 6 canonical cache keys)', () => {
  const { fingerprintFromHeaders, fingerprintArgs, fingerprintCacheArgs } =
    require('./request-fingerprint');

  it('extracts the four primitives, defaulting missing to empty string', () => {
    const h = new Headers();
    h.set('cookie', 'a=b');
    const fp = fingerprintFromHeaders(h);
    expect(fp).toEqual({
      cookie: 'a=b',
      forwardedFor: '',
      realIp: '',
      userAgent: '',
    });
  });

  it('round-trips all four headers in stable tuple order', () => {
    const h = new Headers();
    h.set('cookie', 'c');
    h.set('x-forwarded-for', '1.2.3.4');
    h.set('x-real-ip', '5.6.7.8');
    h.set('user-agent', 'k6');
    expect(fingerprintCacheArgs(h)).toEqual(['c', '1.2.3.4', '5.6.7.8', 'k6']);
    expect(fingerprintArgs(fingerprintFromHeaders(h))).toEqual([
      'c',
      '1.2.3.4',
      '5.6.7.8',
      'k6',
    ]);
  });

  it('two Headers instances with identical values yield identical keys', () => {
    const a = new Headers({ cookie: 'x=1', 'user-agent': 'ua' });
    const b = new Headers({ cookie: 'x=1', 'user-agent': 'ua' });
    expect(fingerprintCacheArgs(a)).toEqual(fingerprintCacheArgs(b));
  });
});
