// k6/config.js
// Centralized configuration and environment defaults for the k6 test suite.

export const BASE_URL = __ENV.BASE_URL || 'https://localhost';

// Credentials come ONLY from env (SEED_ADMIN_* / USER_*). Fallbacks are
// non-personal template placeholders matching .env.example seed values —
// never real mailboxes. Require USER_EMAIL/USER_PASSWORD in .env.k6 for
// suites that exercise the plain-user flow.
export const USERS = {
  admin: {
    email: __ENV.SEED_ADMIN_EMAIL || 'admin@yourapp.com',
    password: __ENV.SEED_ADMIN_PASSWORD || 'YourStrongPassword123!',
    role: 'superAdmin',
  },
  user: {
    email: __ENV.USER_EMAIL || 'user@yourapp.com',
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
//
// Gating: 5xx-only thresholds alone let a dead backend exit 0 when no
// 5xx-tagged requests exist. Every suite below ALSO gates on `checks` (all
// scenario check() calls must pass) so 100% failures fail. Arrival-rate
// suites additionally gate on dropped_iterations. 429 visibility is a
// report-only threshold (always passes, count visible in output).
const FIVE_XX_1PCT = {
  'http_req_failed{status:500}': ['rate<0.01'],
  'http_req_failed{status:502}': ['rate<0.01'],
  'http_req_failed{status:503}': ['rate<0.01'],
  'http_req_failed{status:504}': ['rate<0.01'],
};
const CHECKS_GATE = {
  checks: ['rate>0.99'],
};
const VISIBILITY_429 = {
  // Report-only: threshold always passes, 429 count stays visible.
  'http_reqs{status:429}': ['count>=0'],
};
export const THRESHOLDS = {
  smoke: {
    // Only hard-fail on 5xx server errors — 429s are expected/correct behavior
    ...FIVE_XX_1PCT,
    ...CHECKS_GATE,
    ...VISIBILITY_429,
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
  load: {
    ...FIVE_XX_1PCT,
    ...CHECKS_GATE,
    ...VISIBILITY_429,
    http_req_duration: ['p(95)<400', 'p(99)<800'],
  },
  stress: {
    'http_req_failed{status:500}': ['rate<0.02'],
    'http_req_failed{status:502}': ['rate<0.02'],
    'http_req_failed{status:503}': ['rate<0.02'],
    'http_req_failed{status:504}': ['rate<0.02'],
    ...CHECKS_GATE,
    ...VISIBILITY_429,
    http_req_duration: ['p(95)<2500', 'p(99)<4000'],
  },
  spike: {
    // Under spike, 429s will be very common (intentional) — only fail on 5xx
    'http_req_failed{status:500}': ['rate<0.05'],
    'http_req_failed{status:502}': ['rate<0.05'],
    'http_req_failed{status:503}': ['rate<0.05'],
    'http_req_failed{status:504}': ['rate<0.05'],
    ...CHECKS_GATE,
    ...VISIBILITY_429,
  },
  soak: {
    ...FIVE_XX_1PCT,
    ...CHECKS_GATE,
    ...VISIBILITY_429,
    http_req_duration: ['p(95)<300', 'p(99)<600'],
  },
  // Capacity + edge presets live here (single threshold source).
  // capacity MEASURES the ceiling - no latency gate (breaking point is
  // expected to be slow); dead-backend gates stay (checks + 5xx + drops).
  capacity: {
    checks: ['rate>0.95'],
    'http_req_failed{status:500}': ['rate<0.10'],
    'http_req_failed{status:502}': ['rate<0.10'],
    'http_req_failed{status:503}': ['rate<0.10'],
    'http_req_failed{status:504}': ['rate<0.10'],
    dropped_iterations: ['count==0'],
    ...VISIBILITY_429,
  },
  // edge asserts 4xx shapes - only 5xx fail, checks gate correctness.
  edge: {
    ...FIVE_XX_1PCT,
    ...CHECKS_GATE,
    ...VISIBILITY_429,
  },
};

// Think times (seconds) - one source so suites cannot silently diverge.
export const THINK_TIME_S = {
  smoke: 2,
  loadMin: 0.5,
  loadJitter: 1.5,
  stressMin: 0.2,
  stressJitter: 0.5,
  spike: 0.1,
  soak: 1,
  edge: 1,
};

// Traffic mix weights (must sum to 1) - mirrors the workload the capacity
// suite and load suite both implement (read-heavy, notes-biased).
export const TRAFFIC_MIX = {
  load: { public: 0.4, notes: 0.35, audit: 0.15, auth: 0.1 },
  capacity: { notesRead: 0.4, notesWrite: 0.25, rateLimit: 0.2, health: 0.15 },
};
