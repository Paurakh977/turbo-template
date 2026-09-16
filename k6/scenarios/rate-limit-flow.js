// k6/scenarios/rate-limit-flow.js
// Tests server-action rate limiting via Redis token bucket / sliding window.

import { check } from 'k6';
import { post } from '../helpers/http.js';

export function runRateLimitFlow(sessionCookie) {
  if (!sessionCookie) {
    throw new Error('runRateLimitFlow requires an authenticated sessionCookie');
  }

  // 1. Valid Rate Limit Check (POST /api/rate-limit/check)
  const validPayload = {
    scope: 'notes:create-note',
    windowMs: 60000,
    max: 100,
  };

  const res = post('/api/rate-limit/check', validPayload, {
    cookie: sessionCookie,
    tags: { name: 'POST /api/rate-limit/check' },
  });

  check(res, {
    'rate-limit check status is 201 or 200': (r) => r.status === 201 || r.status === 200,
    'rate-limit check returns allowed verdict': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.allowed === 'boolean';
      } catch {
        return false;
      }
    },
  });

  return res;
}
