// k6/suites/smoke.js
// Smoke Test: Baseline sanity check (2 VUs, 30s)
// Validates end-to-end functionality across all subsystems with minimal load.
// Sessions are established ONCE in setup() to avoid auth rate-limiting.
//
// NOTE: The stack applies Nginx rate limiting at 10 r/s (API) and 5 r/s (auth).
// The smoke test uses 2 VUs with 2s sleep to stay well within both limits.

import { sleep } from 'k6';
import { THRESHOLDS, USERS } from '../config.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runAuthFlow } from '../scenarios/auth-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { runRateLimitFlow } from '../scenarios/rate-limit-flow.js';
import { runWebFlow } from '../scenarios/web-flow.js';
import { signIn } from '../helpers/auth.js';

export const options = {
  // 2 VUs with 2s think time = max ~1 req/s per VU = 2 req/s total - safely under 10r/s limit
  vus: 2,
  duration: '30s',
  insecureSkipTLSVerify: true,
  thresholds: {
    // 429 responses are expected behavior from the rate limiter under load tests.
    // The smoke threshold only fails on 5xx server errors.
    'http_req_failed{status:500}': ['rate<0.01'],
    'http_req_failed{status:502}': ['rate<0.01'],
    'http_req_failed{status:503}': ['rate<0.01'],
    // Latency should be healthy for actual (non-rate-limited) requests
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

// Authenticate ONCE per test run - not per VU iteration.
// This prevents saturating the auth rate-limit zone during smoke validation.
export function setup() {
  const auth = signIn(USERS.admin.email, USERS.admin.password);
  if (!auth.success || !auth.cookie) {
    console.error('[smoke:setup] Admin sign-in failed - check credentials and stack health');
    return { cookie: null };
  }
  console.log('[smoke:setup] Admin session established successfully');
  return { cookie: auth.cookie };
}

export default function (data) {
  // 1. Validate session & check auth metadata (reuse existing cookie, no new sign-in)
  if (data.cookie) {
    runAuthFlow(USERS.admin.email, USERS.admin.password, data.cookie);
  }

  // 2. Test public & health endpoints (no auth needed)
  runPublicFlow();

  // 3. Test Next.js SSR & Faro RUM ingestion
  runWebFlow();

  if (data.cookie) {
    // 4. Test Notes CRUD lifecycle (create → update → delete)
    runNotesFlow(data.cookie);

    // 5. Test Audit Log recording & admin querying
    runAuditFlow(data.cookie);

    // 6. Test Server Action Rate Limiting
    runRateLimitFlow(data.cookie);

    // 7. Test authenticated dashboard page
    runWebFlow(data.cookie);
  }

  // 2 second think time ensures we stay safely within the 10r/s Nginx API limit
  sleep(2);
}
