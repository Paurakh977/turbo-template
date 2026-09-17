jest.mock('./internal-api', () => ({
  callInternalApi: jest.fn(),
}));

import { getServerActionRateLimitMessage } from './server-action-rate-limit';

describe('getServerActionRateLimitMessage', () => {
  it('formats seconds correctly', () => {
    expect(getServerActionRateLimitMessage(5000)).toBe(
      'Too many requests. Please wait 5s and try again.',
    );
  });

  it('rounds up sub-second values', () => {
    expect(getServerActionRateLimitMessage(100)).toBe(
      'Too many requests. Please wait 1s and try again.',
    );
  });

  it('handles zero as minimum 1s', () => {
    expect(getServerActionRateLimitMessage(0)).toBe(
      'Too many requests. Please wait 1s and try again.',
    );
  });

  it('handles large values', () => {
    expect(getServerActionRateLimitMessage(120000)).toBe(
      'Too many requests. Please wait 120s and try again.',
    );
  });

  it('handles exact seconds', () => {
    expect(getServerActionRateLimitMessage(3000)).toBe(
      'Too many requests. Please wait 3s and try again.',
    );
  });
});
