export const AUTH_RATE_LIMIT_EVENT = 'auth:rate-limit';
export const AUTH_RATE_LIMIT_MESSAGE =
  'Too many requests. Please wait a moment and try again.';

export type AuthRateLimitDetail = {
  message?: string;
  /** Seconds the client should wait before retrying (from the Retry-After header). */
  retryAfter?: number;
};
