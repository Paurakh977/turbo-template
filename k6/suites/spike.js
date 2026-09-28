// k6/suites/spike.js
// Spike Test: Sudden, extreme surge in traffic to test rate-limiting shields (Layer 1 Nginx & Layer 2 Better Auth).
// Validates 429 response handling and checks that 5xx errors remain low.

import { sleep } from 'k6';
import { THRESHOLDS, THINK_TIME_S } from '../config.js';
import { setupAdminSession } from '../helpers/setup.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { makeHandleSummary } from '../helpers/summary.js';

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // Baseline calm traffic
    { duration: '30s', target: 5 },    // Hold calm traffic
    { duration: '10s', target: 150 },  // Instant spike to 150 VUs
    { duration: '1m', target: 150 },   // Hold spike (triggers Nginx limit_req & Better Auth 429)
    { duration: '20s', target: 5 },    // Rapid cooldown
    { duration: '30s', target: 5 },    // Verify recovery after spike
    { duration: '10s', target: 0 },    // Ramp-down
  ],
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.spike,
};

export function setup() {
  return setupAdminSession('spike');
}

export default function (data) {
  // During spike, rapid bursts of requests
  if (Math.random() > 0.4) {
    if (data.cookie) {
      runNotesFlow(data.cookie);
    }
  } else {
    runPublicFlow();
  }

  // Centralized think time (config.js): spike minimal cadence.
  sleep(THINK_TIME_S.spike);
}


export const handleSummary = makeHandleSummary('spike');