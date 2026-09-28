// k6/suites/smoke.js
// Smoke Test: Baseline sanity check (2 VUs, 30s)
// Validates end-to-end functionality across all subsystems with minimal load.
// Sessions are established ONCE in setup() to avoid auth rate-limiting.
//
// NOTE: The stack applies Nginx rate limiting at 10 r/s (API) and 5 r/s (auth).
// The smoke test uses 2 VUs with 2s sleep to stay well within both limits.

import { sleep } from 'k6';
import { THRESHOLDS, THINK_TIME_S, USERS } from '../config.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runAuthFlow } from '../scenarios/auth-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { runRateLimitFlow } from '../scenarios/rate-limit-flow.js';
import { runWebFlow } from '../scenarios/web-flow.js';
import { setupAdminSession } from '../helpers/setup.js';
import { makeHandleSummary } from '../helpers/summary.js';

export const options = {
  // 2 VUs with 2s think time = max ~1 req/s per VU = 2 req/s total - safely under 10r/s limit
  vus: 2,
  duration: '30s',
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.smoke,
};

// Authenticate ONCE per test run - not per VU iteration.
// This prevents saturating the auth rate-limit zone during smoke validation.
// Setup failure MUST abort (throw) — returning {cookie:null} would run the
// public-only path and exit 0 on a dead backend.
export function setup() {
  return setupAdminSession('smoke');
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

  // Centralized think time (config.js) keeps suites from silently diverging.
  sleep(THINK_TIME_S.smoke);
}


export const handleSummary = makeHandleSummary('smoke');