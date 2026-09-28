// k6/suites/edge-cases.js
// Dedicated edge-case and boundary condition suite.
// Validates 400, 401, 403, 404, and 429 response codes and error metrics.

import { sleep } from 'k6';
import { runEdgeCasesFlow } from '../scenarios/edge-cases-flow.js';
import { signIn } from '../helpers/auth.js';
import { setupAdminSession } from '../helpers/setup.js';
import { THRESHOLDS, THINK_TIME_S, USERS } from '../config.js';
import { makeHandleSummary } from '../helpers/summary.js';

export const options = {
  vus: 2,
  duration: '30s',
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.edge,
};

export function setup() {
  // Admin session aborts loudly on dead backend; the plain user
  // session degrades to its cookie-or-empty (edge flows assert 401s anyway).
  const admin = setupAdminSession('edge-cases');
  const userAuth = signIn(USERS.user.email, USERS.user.password);
  return {
    adminCookie: admin.cookie,
    userCookie: userAuth.cookie,
  };
}

export default function (data) {
  runEdgeCasesFlow(data.adminCookie, data.userCookie);
  // Centralized think time (config.js): edge cadence.
  sleep(THINK_TIME_S.edge);
}


export const handleSummary = makeHandleSummary('edge-cases');