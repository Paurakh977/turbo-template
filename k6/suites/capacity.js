// k6/suites/capacity.js
// Single-replica capacity probe: stepped arrival-rate to find the maximum
// sustainable RPS of ONE api container (behind PgBouncer, higher pools).
// Steps 200 -> 300 -> 400 -> 500 -> 600 RPS, 60s each. The breaking point is
// where achieved iters/s falls behind target, VUs climb toward maxVUs, and
// dropped_iterations / 5xx start growing. Same workload mix as the retired
// target-1k suite so results are comparable. No pass/fail thresholds here —
// this suite MEASURES the ceiling; read it from the per-stage progress lines.

import { check } from 'k6';
import { THRESHOLDS } from '../config.js';
import { get, post } from '../helpers/http.js';
import { setupAdminSession } from '../helpers/setup.js';
import { generateNotePayload } from '../helpers/data.js';
import { makeHandleSummary } from '../helpers/summary.js';


export const options = {
  scenarios: {
    capacity_steps: {
      executor: 'ramping-arrival-rate',
      startRate: 200,
      timeUnit: '1s',
      preAllocatedVUs: 400,
      maxVUs: 1500,
      stages: [
        { duration: '60s', target: 200 }, // step 1: 200 RPS
        { duration: '60s', target: 300 }, // step 2: 300 RPS
        { duration: '60s', target: 400 }, // step 3: 400 RPS
        { duration: '60s', target: 500 }, // step 4: 500 RPS
        { duration: '60s', target: 600 }, // step 5: 600 RPS
      ],
    },
  },
  insecureSkipTLSVerify: true,
  thresholds: THRESHOLDS.capacity,
};

export function setup() {
  return setupAdminSession('capacity');
}

export default function (data) {
  const rand = Math.random();

  if (rand < 0.40) {
    // 40% DB Read: List notes. withTotal=false mirrors the real web client
    // (page.tsx), which never renders totals — same endpoint/auth/data query,
    // minus the COUNT(*) total probe (P2 read-amplification reduction).
    const res = get('/api/notes?limit=10&offset=0&withTotal=false', {
      cookie: data.cookie,
      tags: { name: 'GET /api/notes' },
    });
    check(res, {
      'notes status is 200': (r) => r.status === 200,
    });
  } else if (rand < 0.65) {
    // 25% DB Write: Create note
    const payload = generateNotePayload();
    const res = post('/api/notes', payload, {
      cookie: data.cookie,
      tags: { name: 'POST /api/notes' },
    });
    check(res, {
      'create note status is 201': (r) => r.status === 201,
    });
  } else if (rand < 0.85) {
    // 20% Redis: Rate limit check
    const validPayload = {
      scope: 'notes:create-note',
      windowMs: 60000,
      max: 100,
    };
    const res = post('/api/rate-limit/check', validPayload, {
      cookie: data.cookie,
      tags: { name: 'POST /api/rate-limit/check' },
    });
    check(res, {
      'rate limit status is 201 or 200': (r) => r.status === 201 || r.status === 200,
    });
  } else {
    // 15% Health Ready
    const res = get('/api/health/ready', {
      tags: { name: 'GET /api/health/ready' },
    });
    check(res, {
      'health ready is 200': (r) => r.status === 200,
    });
  }
}


export const handleSummary = makeHandleSummary('capacity');