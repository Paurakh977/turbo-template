import {
  safeDecodeParam,
  isRateLimitedAuthError,
  getResendVerificationPublicMessage,
  getForgotPasswordPublicMessage,
  getResetPasswordPublicError,
  getVerifyEmailPublicError,
  getVerifyEmailCallbackError,
} from '../lib/auth-errors';

describe('safeDecodeParam', () => {
  it('decodes valid URI component', () => {
    expect(safeDecodeParam('hello%20world')).toBe('hello world');
  });

  it('returns raw value for malformed percent encoding', () => {
    expect(safeDecodeParam('100%')).toBe('100%');
  });

  it('returns raw value for invalid encoding', () => {
    expect(safeDecodeParam('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('decodes fully encoded string', () => {
    expect(safeDecodeParam('%7B%22error%22%3Atrue%7D')).toBe(
      '{"error":true}',
    );
  });
});

describe('isRateLimitedAuthError', () => {
  it('returns true for status 429', () => {
    expect(isRateLimitedAuthError({ status: 429 })).toBe(true);
  });

  it('returns false for status 400', () => {
    expect(isRateLimitedAuthError({ status: 400 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isRateLimitedAuthError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRateLimitedAuthError(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isRateLimitedAuthError({})).toBe(false);
  });
});

describe('getResendVerificationPublicMessage', () => {
  it('returns rate limit message for 429', () => {
    expect(
      getResendVerificationPublicMessage({ status: 429 }),
    ).toContain('Too many requests');
  });

  it('returns default message for other errors', () => {
    expect(
      getResendVerificationPublicMessage({ status: 500 }),
    ).toContain('verification link');
  });

  it('returns default message for null error', () => {
    expect(getResendVerificationPublicMessage(null)).toContain(
      'verification link',
    );
  });
});

describe('getForgotPasswordPublicMessage', () => {
  it('returns rate limit message for 429', () => {
    expect(
      getForgotPasswordPublicMessage({ status: 429 }),
    ).toContain('Too many requests');
  });

  it('returns default message for other errors', () => {
    expect(
      getForgotPasswordPublicMessage({ status: 500 }),
    ).toContain('reset link');
  });

  it('returns default message for null error', () => {
    expect(getForgotPasswordPublicMessage(null)).toContain('reset link');
  });
});

describe('getResetPasswordPublicError', () => {
  it('returns rate limit message for 429', () => {
    expect(
      getResetPasswordPublicError({ status: 429 }),
    ).toContain('Too many attempts');
  });

  it('returns invalid token message for 400', () => {
    expect(
      getResetPasswordPublicError({ status: 400 }),
    ).toContain('invalid or expired');
  });

  it('returns invalid token message for TOKEN code', () => {
    expect(
      getResetPasswordPublicError({ code: 'TOKEN_EXPIRED' }),
    ).toContain('invalid or expired');
  });

  it('returns invalid token message for INVALID_TOKEN code', () => {
    expect(
      getResetPasswordPublicError({ code: 'INVALID_TOKEN' }),
    ).toContain('invalid or expired');
  });

  it('returns generic message for other errors', () => {
    expect(
      getResetPasswordPublicError({ status: 500 }),
    ).toContain('Could not reset password');
  });

  it('returns generic message for null error', () => {
    expect(getResetPasswordPublicError(null)).toContain(
      'Could not reset password',
    );
  });
});

describe('getVerifyEmailPublicError', () => {
  it('returns rate limit message for 429', () => {
    expect(
      getVerifyEmailPublicError({ status: 429 }),
    ).toContain('Too many attempts');
  });

  it('returns invalid token message for 400', () => {
    expect(
      getVerifyEmailPublicError({ status: 400 }),
    ).toContain('invalid or expired');
  });

  it('returns invalid token message for TOKEN code', () => {
    expect(
      getVerifyEmailPublicError({ code: 'TOKEN_EXPIRED' }),
    ).toContain('invalid or expired');
  });

  it('returns generic message for other errors', () => {
    expect(
      getVerifyEmailPublicError({ status: 500 }),
    ).toContain('Unable to verify email');
  });

  it('returns generic message for null error', () => {
    expect(getVerifyEmailPublicError(null)).toContain('Unable to verify email');
  });
});

describe('getVerifyEmailCallbackError', () => {
  it('returns empty string for null', () => {
    expect(getVerifyEmailCallbackError(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(getVerifyEmailCallbackError('')).toBe('');
  });

  it('returns invalid token message for INVALID_TOKEN', () => {
    expect(getVerifyEmailCallbackError('INVALID_TOKEN')).toContain(
      'invalid or expired',
    );
  });

  it('returns invalid token message for TOKEN in string', () => {
    expect(getVerifyEmailCallbackError('token_expired')).toContain(
      'invalid or expired',
    );
  });

  it('returns generic message for unknown error', () => {
    expect(getVerifyEmailCallbackError('unknown_error')).toContain(
      'Unable to verify email',
    );
  });

  it('is case-insensitive', () => {
    expect(getVerifyEmailCallbackError('invalid_token')).toContain(
      'invalid or expired',
    );
  });
});
