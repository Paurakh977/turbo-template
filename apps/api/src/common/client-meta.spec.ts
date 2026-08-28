import { extractClientMeta } from './client-meta';

function makeReq(overrides: {
  ip?: string;
  userAgent?: string;
  xRealIp?: string;
} = {}) {
  return {
    ip: overrides.ip,
    headers: {
      'user-agent': overrides.userAgent,
      'x-real-ip': overrides.xRealIp,
    },
  } as Parameters<typeof extractClientMeta>[0];
}

describe('extractClientMeta', () => {
  it('returns ip from req.ip', () => {
    const req = makeReq({ ip: '203.0.113.5', userAgent: 'Mozilla/5.0' });
    expect(extractClientMeta(req)).toEqual({
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('falls back to x-real-ip when req.ip is empty', () => {
    const req = makeReq({ ip: '', xRealIp: '10.0.0.1' });
    expect(extractClientMeta(req)).toEqual({
      ip: '10.0.0.1',
      userAgent: null,
    });
  });

  it('falls back to x-real-ip when req.ip is undefined', () => {
    const req = makeReq({ xRealIp: '10.0.0.1' });
    expect(extractClientMeta(req)).toEqual({
      ip: '10.0.0.1',
      userAgent: null,
    });
  });

  it('returns null ip when neither req.ip nor x-real-ip present', () => {
    const req = makeReq({ userAgent: 'TestBot' });
    expect(extractClientMeta(req)).toEqual({
      ip: null,
      userAgent: 'TestBot',
    });
  });

  it('returns null ip when req.ip is null', () => {
    const req = {
      ip: null,
      headers: { 'user-agent': 'Test' },
    } as unknown as Parameters<typeof extractClientMeta>[0];
    expect(extractClientMeta(req)).toEqual({
      ip: null,
      userAgent: 'Test',
    });
  });

  it('returns null userAgent when user-agent header is missing', () => {
    const req = {
      ip: '1.2.3.4',
      headers: {},
    } as unknown as Parameters<typeof extractClientMeta>[0];
    expect(extractClientMeta(req)).toEqual({
      ip: '1.2.3.4',
      userAgent: null,
    });
  });

  it('returns full user agent string', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const req = makeReq({ userAgent: ua });
    expect(extractClientMeta(req).userAgent).toBe(ua);
  });

  it('prefers req.ip over x-real-ip', () => {
    const req = makeReq({ ip: '1.1.1.1', xRealIp: '2.2.2.2' });
    expect(extractClientMeta(req).ip).toBe('1.1.1.1');
  });
});
