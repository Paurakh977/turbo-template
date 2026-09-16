// k6/config.js
// Centralized configuration and environment defaults for the k6 test suite.

export const BASE_URL = __ENV.BASE_URL || 'https://localhost';

export const USERS = {
  admin: {
    email: __ENV.SEED_ADMIN_EMAIL || 'admin@yourapp.com',
    password: __ENV.SEED_ADMIN_PASSWORD || 'YourStrongPassword123!',
    role: 'superAdmin',
  },
  user: {
    email: __ENV.USER_EMAIL || 'dollarchaeyo@gmail.com',
    password: __ENV.USER_PASSWORD || 'UserPassword123!',
    role: 'user',
  },
};

// NOTE: no X-Bypass-Rate-Limit header — nginx has no bypass (empty limit_req
// keys are uncounted per nginx docs, so any client header would be an
// unauthenticated global rate-limit disable). k6 runs against real limits;
// thresholds below treat 429 as expected, and spike.js asserts 429s fire.
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  Origin: BASE_URL,
};

// NOTE: http_req_failed by default counts ANY non-2xx response as "failed",
// including 429 Too Many Requests. Since our Nginx rate limiting intentionally
// returns 429, we scope failure thresholds to only 5xx server errors.
// This ensures rate limiting is observed via metrics without causing false failures.
export const THRESHOLDS = {
  smoke: {
    // Only hard-fail on 5xx server errors — 429s are expected/correct behavior
    'http_req_failed{status:500}': ['rate<0.01'],
    'http_req_failed{status:502}': ['rate<0.01'],
    'http_req_failed{status:503}': ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
  load: {
    'http_req_failed{status:500}': ['rate<0.01'],
    'http_req_failed{status:502}': ['rate<0.01'],
    'http_req_failed{status:503}': ['rate<0.01'],
    http_req_duration: ['p(95)<400', 'p(99)<800'],
  },
  stress: {
    'http_req_failed{status:500}': ['rate<0.02'],
    'http_req_failed{status:502}': ['rate<0.02'],
    'http_req_failed{status:503}': ['rate<0.02'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  },
  spike: {
    // Under spike, 429s will be very common (intentional) — only fail on 5xx
    'http_req_failed{status:500}': ['rate<0.05'],
    'http_req_failed{status:502}': ['rate<0.05'],
    'http_req_failed{status:503}': ['rate<0.05'],
  },
  soak: {
    'http_req_failed{status:500}': ['rate<0.01'],
    'http_req_failed{status:502}': ['rate<0.01'],
    'http_req_failed{status:503}': ['rate<0.01'],
    http_req_duration: ['p(95)<300', 'p(99)<600'],
  },
};
