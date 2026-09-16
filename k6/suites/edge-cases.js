// k6/suites/edge-cases.js
// Dedicated edge-case and boundary condition suite.
// Validates 400, 401, 403, 404, and 429 response codes and error metrics.

import { sleep } from 'k6';
import { runEdgeCasesFlow } from '../scenarios/edge-cases-flow.js';
import { signIn } from '../helpers/auth.js';
import { USERS } from '../config.js';

export const options = {
  vus: 2,
  duration: '30s',
  insecureSkipTLSVerify: true,
  thresholds: {
    // In edge case tests, status 4xx are explicitly tested and expected
    'http_req_failed{status:500}': ['rate<0.01'],
  },
};

export function setup() {
  const adminAuth = signIn(USERS.admin.email, USERS.admin.password);
  const userAuth = signIn(USERS.user.email, USERS.user.password);
  return {
    adminCookie: adminAuth.cookie,
    userCookie: userAuth.cookie,
  };
}

export default function (data) {
  runEdgeCasesFlow(data.adminCookie, data.userCookie);
  sleep(1);
}
