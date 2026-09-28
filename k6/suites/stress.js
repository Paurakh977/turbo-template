// k6/suites/stress.js
// Stress Test: Pushes concurrency beyond standard capacity (up to 500 VUs).
// Exercises PostgreSQL pool saturation, Redis command rate, and triggers Pyroscope CPU profiling.

import { sleep } from 'k6';
import { THRESHOLDS, THINK_TIME_S } from '../config.js';
import { setupAdminSession } from '../helpers/setup.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { runRateLimitFlow } from '../scenarios/rate-limit-flow.js';
import { makeHandleSummary } from '../helpers/summary.js';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp to normal
    { duration: '1m', target: 150 },   // Ramp beyond normal
    { duration: '1m', target: 300 },   // Approaching saturation
    { duration: '1m', target: 500 },   // Maximum stress target
    { duration: '2m', target: 500 },   // Hold maximum stress
    { duration: '1m', target: 0 },     // Ramp-down
  ],
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.stress,
};

export function setup() {
  return setupAdminSession('stress');
}

export default function (data) {
  const rand = Math.random();

  if (rand < 0.5) {
    if (data.cookie) {
      runNotesFlow(data.cookie);
    }
  } else if (rand < 0.8) {
    if (data.cookie) {
      runAuditFlow(data.cookie);
      runRateLimitFlow(data.cookie);
    }
  } else {
    runPublicFlow();
  }

  // Centralized think time (config.js): stress fast-push cadence.
  sleep(THINK_TIME_S.stressMin + Math.random() * THINK_TIME_S.stressJitter);
}


export const handleSummary = makeHandleSummary('stress');