import {
  AUTH_RATE_LIMIT_EVENT,
  AUTH_RATE_LIMIT_MESSAGE,
  type AuthRateLimitDetail,
} from './auth-rate-limit-event';

describe('AUTH_RATE_LIMIT_EVENT', () => {
  it('is "auth:rate-limit"', () => {
    expect(AUTH_RATE_LIMIT_EVENT).toBe('auth:rate-limit');
  });
});

describe('AUTH_RATE_LIMIT_MESSAGE', () => {
  it('is a non-empty string', () => {
    expect(typeof AUTH_RATE_LIMIT_MESSAGE).toBe('string');
    expect(AUTH_RATE_LIMIT_MESSAGE.length).toBeGreaterThan(0);
  });

  it('mentions "Too many"', () => {
    expect(AUTH_RATE_LIMIT_MESSAGE).toContain('Too many');
  });
});

describe('AuthRateLimitDetail type', () => {
  it('has optional message and retryAfter', () => {
    const detail: AuthRateLimitDetail = {};
    expect(detail.message).toBeUndefined();
    expect(detail.retryAfter).toBeUndefined();
  });

  it('accepts message and retryAfter', () => {
    const detail: AuthRateLimitDetail = {
      message: 'Rate limited',
      retryAfter: 10,
    };
    expect(detail.message).toBe('Rate limited');
    expect(detail.retryAfter).toBe(10);
  });
});
