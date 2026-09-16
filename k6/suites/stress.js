// k6/suites/stress.js
// Stress Test: Pushes concurrency beyond standard capacity (up to 200 VUs).
// Exercises PostgreSQL pool saturation, Redis command rate, and triggers Pyroscope CPU profiling.

import { sleep } from 'k6';
import { THRESHOLDS, USERS } from '../config.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { runAuditFlow } from '../scenarios/audit-flow.js';
import { runRateLimitFlow } from '../scenarios/rate-limit-flow.js';
import { signIn } from '../helpers/auth.js';

export const options = {
  stages: [
    { duration: '30s', target: 25 },   // Ramp to normal
    { duration: '1m', target: 75 },    // Ramp beyond normal
    { duration: '1m', target: 150 },   // Approaching saturation
    { duration: '1m', target: 200 },   // Maximum stress target
    { duration: '2m', target: 200 },   // Hold maximum stress
    { duration: '1m', target: 0 },     // Ramp-down
  ],
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.stress,
};

export function setup() {
  const auth = signIn(USERS.admin.email, USERS.admin.password);
  return {
    cookie: auth.cookie,
  };
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

  // Under stress, fast requests to push concurrency
  sleep(0.2 + Math.random() * 0.5);
}
