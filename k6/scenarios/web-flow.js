// k6/scenarios/web-flow.js
// Tests Next.js SSR pages and Grafana Faro RUM telemetry collection.

import { check } from 'k6';
import { get, post } from '../helpers/http.js';

export function runWebFlow(sessionCookie) {
  // 1. Landing Page (SSR)
  const homeRes = get('/', {
    headers: { Accept: 'text/html' },
    tags: { name: 'GET /' },
  });
  check(homeRes, {
    'landing page status is 200': (r) => r.status === 200,
  });

  // 2. Auth Page (SSR)
  const authPageRes = get('/auth', {
    headers: { Accept: 'text/html' },
    tags: { name: 'GET /auth' },
  });
  check(authPageRes, {
    'auth page status is 200': (r) => r.status === 200,
  });

  // 3. Authenticated Dashboard Page (SSR)
  if (sessionCookie) {
    const dashRes = get('/dashboard', {
      cookie: sessionCookie,
      headers: { Accept: 'text/html' },
      tags: { name: 'GET /dashboard' },
    });
    check(dashRes, {
      'dashboard page status is 200': (r) => r.status === 200,
    });
  }

  // 4. Faro RUM Telemetry Ingestion (POST /collect -> Nginx -> Alloy:12347)
  const faroPayload = {
    app: {
      name: 'web',
      version: 'dev',
      environment: 'development',
    },
    meta: {
      session: { id: `k6-session-${Date.now()}` },
      view: { name: 'home' },
    },
    measurements: [
      {
        type: 'web-vitals',
        values: {
          cls: 0.01,
          fcp: 240,
          fid: 5,
          lcp: 450,
          ttfb: 120,
        },
      },
    ],
  };

  const faroRes = post('/collect', faroPayload, {
    tags: { name: 'POST /collect (Faro RUM)' },
  });

  check(faroRes, {
    'faro telemetry accepted (2xx)': (r) => r.status >= 200 && r.status < 300,
  });

  return {
    homeRes,
    faroRes,
  };
}
