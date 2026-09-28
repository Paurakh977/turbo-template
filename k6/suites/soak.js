// k6/suites/soak.js
// Soak Test: Steady-state continuous load to detect memory leaks and connection leaks.
// Monitored via Grafana Dashboards 01-system-overview (RAM usage) and 03-database-redis (PG connections).

import { sleep } from 'k6';
import { THRESHOLDS, THINK_TIME_S } from '../config.js';
import { setupAdminSession } from '../helpers/setup.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { makeHandleSummary } from '../helpers/summary.js';

const DURATION = __ENV.SOAK_DURATION || '10m';

export const options = {
  stages: [
    { duration: '1m', target: 20 },     // Ramp-up to 20 VUs
    { duration: DURATION, target: 20 }, // Sustained steady state
    { duration: '1m', target: 0 },      // Ramp-down
  ],
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.soak,
};

export function setup() {
  return setupAdminSession('soak');
}

export default function (data) {
  const rand = Math.random();

  if (rand < 0.4) {
    runPublicFlow();
  } else if (rand < 0.8) {
    if (data.cookie) {
      runNotesFlow(data.cookie);
    }
  } else {
    if (data.cookie) {
      runAuditFlow(data.cookie);
    }
  }

  // Centralized think time (config.js): soak steady cadence.
  sleep(THINK_TIME_S.soak);
}


export const handleSummary = makeHandleSummary('soak');