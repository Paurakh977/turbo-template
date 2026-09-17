import { resolveClientIp, TRUSTED_PROXY_CIDRS } from './client-ip';

function makeHeaders(
  xff?: string | null,
  xRealIp?: string | null,
): { get(name: string): string | null | undefined } {
  return {
    get(name: string) {
      if (name === 'x-forwarded-for') return xff ?? undefined;
      if (name === 'x-real-ip') return xRealIp ?? undefined;
      return undefined;
    },
  };
}

describe('resolveClientIp', () => {
  describe('no headers', () => {
    it('returns undefined for null headers', () => {
      expect(resolveClientIp(null)).toBeUndefined();
    });

    it('returns undefined for undefined headers', () => {
      expect(resolveClientIp(undefined)).toBeUndefined();
    });

    it('returns undefined when no IP headers present', () => {
      expect(resolveClientIp(makeHeaders())).toBeUndefined();
    });
  });

  describe('x-real-ip fallback', () => {
    it('returns x-real-ip when no XFF present', () => {
      expect(resolveClientIp(makeHeaders(null, '203.0.113.5'))).toBe(
        '203.0.113.5',
      );
    });

    it('returns x-real-ip with whitespace trimmed', () => {
      expect(resolveClientIp(makeHeaders(null, '  203.0.113.5  '))).toBe(
        '203.0.113.5',
      );
    });

    it('returns undefined for invalid x-real-ip', () => {
      expect(resolveClientIp(makeHeaders(null, 'not-an-ip'))).toBeUndefined();
    });

    it('rejects non-canonical IPv4 in x-real-ip', () => {
      expect(resolveClientIp(makeHeaders(null, '010.0.0.1'))).toBeUndefined();
    });

    it('accepts valid IPv6 in x-real-ip', () => {
      expect(resolveClientIp(makeHeaders(null, '::1'))).toBe('::1');
    });
  });

  describe('x-forwarded-for single hop', () => {
    it('returns public IP from single XFF entry', () => {
      expect(resolveClientIp(makeHeaders('203.0.113.5'))).toBe('203.0.113.5');
    });

    it('returns undefined for malformed single entry', () => {
      expect(resolveClientIp(makeHeaders('not-an-ip'))).toBeUndefined();
    });

    it('returns undefined for non-canonical single entry', () => {
      expect(resolveClientIp(makeHeaders('010.0.0.1'))).toBeUndefined();
    });
  });

  describe('x-forwarded-for with trusted proxies', () => {
    it('skips trusted proxy (127.0.0.1) and returns client', () => {
      expect(resolveClientIp(makeHeaders('203.0.113.5, 127.0.0.1'))).toBe(
        '203.0.113.5',
      );
    });

    it('skips trusted proxy (10.x) and returns client', () => {
      expect(resolveClientIp(makeHeaders('203.0.113.5, 10.0.0.1'))).toBe(
        '203.0.113.5',
      );
    });

    it('skips trusted proxy (172.16.x) and returns client', () => {
      expect(resolveClientIp(makeHeaders('203.0.113.5, 172.16.0.1'))).toBe(
        '203.0.113.5',
      );
    });

    it('skips trusted proxy (192.168.x) and returns client', () => {
      expect(
        resolveClientIp(makeHeaders('203.0.113.5, 192.168.1.1')),
      ).toBe('203.0.113.5');
    });

    it('skips multiple trusted proxies and returns first untrusted', () => {
      expect(
        resolveClientIp(
          makeHeaders('203.0.113.5, 10.0.0.1, 172.16.0.1'),
        ),
      ).toBe('203.0.113.5');
    });

    it('walks right-to-left past all trusted proxies', () => {
      expect(
        resolveClientIp(
          makeHeaders('10.0.0.2, 10.0.0.1, 203.0.113.5'),
        ),
      ).toBe('203.0.113.5');
    });
  });

  describe('x-forwarded-for with IPv6', () => {
    it('returns IPv6 client from XFF', () => {
      expect(resolveClientIp(makeHeaders('2001:db8::1'))).toBe(
        '2001:db8::1',
      );
    });

    it('skips IPv6 loopback and returns client', () => {
      expect(
        resolveClientIp(makeHeaders('203.0.113.5, ::1')),
      ).toBe('203.0.113.5');
    });
  });

  describe('malformed input aborts chain', () => {
    it('returns undefined when last hop is malformed', () => {
      expect(
        resolveClientIp(makeHeaders('203.0.113.5, garbage')),
      ).toBeUndefined();
    });

    it('returns undefined when any hop is malformed (hostname)', () => {
      expect(
        resolveClientIp(
          makeHeaders('203.0.113.5, evil.example.com, 10.0.0.1'),
        ),
      ).toBeUndefined();
    });

    it('returns undefined for ip:port format', () => {
      expect(
        resolveClientIp(makeHeaders('1.2.3.4:1337')),
      ).toBeUndefined();
    });

    it('returns undefined for non-canonical octets in chain', () => {
      expect(
        resolveClientIp(makeHeaders('203.0.113.5, 010.0.0.1')),
      ).toBeUndefined();
    });
  });

  describe('empty and edge cases', () => {
    it('returns undefined for empty XFF string', () => {
      expect(resolveClientIp(makeHeaders(''))).toBeUndefined();
    });

    it('returns undefined for whitespace-only XFF', () => {
      expect(resolveClientIp(makeHeaders('   '))).toBeUndefined();
    });

    it('handles XFF with extra spaces around commas', () => {
      expect(
        resolveClientIp(makeHeaders('  203.0.113.5 , 10.0.0.1 ')),
      ).toBe('203.0.113.5');
    });

    it('returns undefined for empty XFF entry between commas', () => {
      expect(
        resolveClientIp(makeHeaders('203.0.113.5,,10.0.0.1')),
      ).toBeUndefined();
    });
  });

  describe('TRUSTED_PROXY_CIDRS', () => {
    it('contains RFC1918 ranges and loopback', () => {
      expect(TRUSTED_PROXY_CIDRS).toContain('10.0.0.0/8');
      expect(TRUSTED_PROXY_CIDRS).toContain('172.16.0.0/12');
      expect(TRUSTED_PROXY_CIDRS).toContain('192.168.0.0/16');
      expect(TRUSTED_PROXY_CIDRS).toContain('127.0.0.1');
      expect(TRUSTED_PROXY_CIDRS).toContain('::1');
    });
  });
});
