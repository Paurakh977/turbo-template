// k6/suites/spike.js
// Spike Test: Sudden, extreme surge in traffic to test rate-limiting shields (Layer 1 Nginx & Layer 2 Better Auth).
// Validates 429 response handling and checks that 5xx errors remain low.

import { sleep } from 'k6';
import { THRESHOLDS, USERS } from '../config.js';
import { runPublicFlow } from '../scenarios/public-flow.js';
import { runNotesFlow } from '../scenarios/notes-flow.js';
import { signIn } from '../helpers/auth.js';

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
  const auth = signIn(USERS.admin.email, USERS.admin.password);
  return {
    cookie: auth.cookie,
  };
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

  // Very short sleep during spike to maximize concurrent connection pressure
  sleep(0.1);
}
