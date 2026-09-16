// k6/scenarios/public-flow.js
// Tests public, unauthenticated API endpoints: health probes and links directory.

import { check } from 'k6';
import { get } from '../helpers/http.js';

export function runPublicFlow() {
  // 1. Liveness Probe
  const liveRes = get('/api/health/live', {
    tags: { name: 'GET /api/health/live' },
  });
  check(liveRes, {
    'health live is 200': (r) => r.status === 200,
    'health live status ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok';
      } catch {
        return false;
      }
    },
  });

  // 2. Readiness Probe (validates Redis and PostgreSQL connections)
  const readyRes = get('/api/health/ready', {
    tags: { name: 'GET /api/health/ready' },
  });
  check(readyRes, {
    'health ready is 200': (r) => r.status === 200,
    'health ready dependencies ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ready' && body.checks.database === 'ok' && body.checks.redis === 'ok';
      } catch {
        return false;
      }
    },
  });

  // 3. Links Directory
  const linksRes = get('/api/links', {
    tags: { name: 'GET /api/links' },
  });
  check(linksRes, {
    'links list is 200': (r) => r.status === 200,
    'links is array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body));
      } catch {
        return false;
      }
    },
  });

  // 4. Single Link Fetch
  const linkItemRes = get('/api/links/0', {
    tags: { name: 'GET /api/links/:id' },
  });
  check(linkItemRes, {
    'single link is 200': (r) => r.status === 200,
  });

  return {
    liveRes,
    readyRes,
    linksRes,
  };
}
