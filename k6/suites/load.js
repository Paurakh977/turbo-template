// k6/suites/load.js
// Production Load Test: Simulates realistic daily user concurrency and workload patterns.
// Validates RED metrics (Rate, Errors, Duration) in Grafana Dashboard 02-api-performance.

import { sleep } from 'k6';
import { THRESHOLDS } from '../config.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runAuthFlow } from '../scenarios/auth-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { runRateLimitFlow } from '../scenarios/rate-limit-flow.js';
import { runWebFlow } from '../scenarios/web-flow.js';
import { signIn } from '../helpers/auth.js';
import { USERS } from '../config.js';

const isQuick = __ENV.LOAD_QUICK === 'true';

export const options = {
  stages: isQuick
    ? [
        { duration: '10s', target: 10 },
        { duration: '20s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '10s', target: 0 },
      ]
    : [
        { duration: '30s', target: 10 },  // Ramp-up to 10 VUs
        { duration: '1m', target: 25 },   // Ramp to normal traffic (25 VUs)
        { duration: '2m', target: 25 },   // Sustained normal traffic
        { duration: '1m', target: 50 },   // Ramp to peak traffic (50 VUs)
        { duration: '2m', target: 50 },   // Sustained peak
        { duration: '30s', target: 0 },   // Ramp-down
      ],
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.load,
};

// Global session setup for sustained load without re-authenticating on every tick
export function setup() {
  const auth = signIn(USERS.admin.email, USERS.admin.password);
  return {
    cookie: auth.cookie,
  };
}

export default function (data) {
  const rand = Math.random();

  // 1. Browsing & Public Probes (40% of traffic)
  if (rand < 0.40) {
    runPublicFlow();
    runWebFlow(data.cookie);
  }
  // 2. Notes Operations & Business Logic (35% of traffic)
  else if (rand < 0.75) {
    if (data.cookie) {
      runNotesFlow(data.cookie);
    }
  }
  // 3. Audit & Rate Limiting (15% of traffic)
  else if (rand < 0.90) {
    if (data.cookie) {
      runAuditFlow(data.cookie);
      runRateLimitFlow(data.cookie);
    }
  }
  // 4. Authentication Session Validation (10% of traffic)
  else {
    runAuthFlow(USERS.admin.email, USERS.admin.password, data.cookie);
  }

  // Realistic user think time between 0.5s and 2s
  sleep(0.5 + Math.random() * 1.5);
}
