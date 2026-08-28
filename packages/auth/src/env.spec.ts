describe('env.ts', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.APP_NAME = 'TestApp';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    process.env.EMAIL_FROM = 'Test <test@example.com>';
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('getEnv', () => {
    it('returns the value when env var exists', () => {
      process.env.MY_VAR = 'hello';
      const { getEnv } = require('./env');
      expect(getEnv('MY_VAR')).toBe('hello');
    });

    it('trims whitespace from value', () => {
      process.env.MY_VAR = '  hello  ';
      const { getEnv } = require('./env');
      expect(getEnv('MY_VAR')).toBe('hello');
    });

    it('returns undefined for missing optional var', () => {
      delete process.env.MY_VAR;
      const { getEnv } = require('./env');
      expect(getEnv('MY_VAR', { required: false })).toBeUndefined();
    });

    it('throws for missing required var', () => {
      delete process.env.MY_VAR;
      const { getEnv } = require('./env');
      expect(() => getEnv('MY_VAR')).toThrow(
        'Missing required environment variable: MY_VAR',
      );
    });

    it('treats empty string as missing', () => {
      process.env.MY_VAR = '   ';
      const { getEnv } = require('./env');
      expect(getEnv('MY_VAR', { required: false })).toBeUndefined();
    });
  });

  describe('parseIntEnv', () => {
    it('returns the parsed integer', () => {
      process.env.MY_NUM = '42';
      const { parseIntEnv } = require('./env');
      expect(parseIntEnv('MY_NUM', 10)).toBe(42);
    });

    it('returns fallback for empty env var', () => {
      delete process.env.MY_NUM;
      const { parseIntEnv } = require('./env');
      expect(parseIntEnv('MY_NUM', 99)).toBe(99);
    });

    it('returns fallback for whitespace-only env var', () => {
      process.env.MY_NUM = '   ';
      const { parseIntEnv } = require('./env');
      expect(parseIntEnv('MY_NUM', 99)).toBe(99);
    });

    it('throws for non-numeric string', () => {
      process.env.MY_NUM = 'abc';
      const { parseIntEnv } = require('./env');
      expect(() => parseIntEnv('MY_NUM', 10)).toThrow('Invalid MY_NUM');
    });

    it('throws for mixed alphanumeric', () => {
      process.env.MY_NUM = '7d';
      const { parseIntEnv } = require('./env');
      expect(() => parseIntEnv('MY_NUM', 10)).toThrow('Invalid MY_NUM');
    });

    it('throws for hex notation', () => {
      process.env.MY_NUM = '0x10';
      const { parseIntEnv } = require('./env');
      expect(() => parseIntEnv('MY_NUM', 10)).toThrow('Invalid MY_NUM');
    });

    it('throws for value below minimum', () => {
      process.env.MY_NUM = '3';
      const { parseIntEnv } = require('./env');
      expect(() => parseIntEnv('MY_NUM', 10, { min: 5 })).toThrow(
        'must be a whole number >= 5',
      );
    });

    it('accepts value at minimum', () => {
      process.env.MY_NUM = '5';
      const { parseIntEnv } = require('./env');
      expect(parseIntEnv('MY_NUM', 10, { min: 5 })).toBe(5);
    });

    it('defaults min to 1', () => {
      process.env.MY_NUM = '0';
      const { parseIntEnv } = require('./env');
      expect(() => parseIntEnv('MY_NUM', 10)).toThrow(
        'must be a whole number >= 1',
      );
    });
  });

  describe('derived constants', () => {
    it('isProduction reflects NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      const mod = require('./env');
      expect(mod.isProduction).toBe(true);
    });

    it('isProduction is false in test', () => {
      process.env.NODE_ENV = 'test';
      const mod = require('./env');
      expect(mod.isProduction).toBe(false);
    });

    it('canSendEmail is true when RESEND_API_KEY is set', () => {
      process.env.RESEND_API_KEY = 're_123';
      const mod = require('./env');
      expect(mod.canSendEmail).toBe(true);
    });

    it('canSendEmail is false when RESEND_API_KEY is missing', () => {
      delete process.env.RESEND_API_KEY;
      const mod = require('./env');
      expect(mod.canSendEmail).toBe(false);
    });

    it('hasGoogle is true when both credentials are set', () => {
      process.env.GOOGLE_CLIENT_ID = 'gc_id';
      process.env.GOOGLE_CLIENT_SECRET = 'gc_secret';
      const mod = require('./env');
      expect(mod.hasGoogle).toBe(true);
    });

    it('hasGoogle is false when only id is set', () => {
      process.env.GOOGLE_CLIENT_ID = 'gc_id';
      delete process.env.GOOGLE_CLIENT_SECRET;
      const mod = require('./env');
      expect(mod.hasGoogle).toBe(false);
    });

    it('hasGithub is true when both credentials are set', () => {
      process.env.GITHUB_CLIENT_ID = 'gh_id';
      process.env.GITHUB_CLIENT_SECRET = 'gh_secret';
      const mod = require('./env');
      expect(mod.hasGithub).toBe(true);
    });

    it('hasGithub is false when only secret is set', () => {
      delete process.env.GITHUB_CLIENT_ID;
      process.env.GITHUB_CLIENT_SECRET = 'gh_secret';
      const mod = require('./env');
      expect(mod.hasGithub).toBe(false);
    });

    it('usingPlaceholderSecret is true in production with default secret', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BETTER_AUTH_SECRET;
      const mod = require('./env');
      expect(mod.usingPlaceholderSecret).toBe(true);
    });

    it('usingPlaceholderSecret is false when secret is provided', () => {
      process.env.NODE_ENV = 'production';
      process.env.BETTER_AUTH_SECRET = 'my-real-secret-that-is-at-least-32chars';
      const mod = require('./env');
      expect(mod.usingPlaceholderSecret).toBe(false);
    });

    it('usingPlaceholderSecret is false in non-production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.BETTER_AUTH_SECRET;
      const mod = require('./env');
      expect(mod.usingPlaceholderSecret).toBe(false);
    });

    it('secret falls back to dev-secret in non-production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.BETTER_AUTH_SECRET;
      const mod = require('./env');
      expect(mod.secret).toBe('dev-secret');
    });

    it('secret uses placeholder in production when not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BETTER_AUTH_SECRET;
      const mod = require('./env');
      expect(mod.secret).toBe('build-time-placeholder-secret');
    });

    it('baseURL falls back to localhost:3000 in non-production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.BETTER_AUTH_URL;
      const mod = require('./env');
      expect(mod.baseURL).toBe('http://localhost:3000');
    });

    it('baseURL falls back to localhost in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.BETTER_AUTH_URL;
      const mod = require('./env');
      expect(mod.baseURL).toBe('http://localhost');
    });

    it('baseURL uses BETTER_AUTH_URL when set', () => {
      process.env.BETTER_AUTH_URL = 'https://auth.example.com';
      const mod = require('./env');
      expect(mod.baseURL).toBe('https://auth.example.com');
    });
  });
});
