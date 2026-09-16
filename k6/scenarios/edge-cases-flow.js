// k6/scenarios/edge-cases-flow.js
// Dedicated edge-case and security boundary validation:
// 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests.

import http from 'k6/http';
import { check } from 'k6';
import { get, post, patch, del } from '../helpers/http.js';
import { signIn } from '../helpers/auth.js';
import { USERS, BASE_URL } from '../config.js';

export function runEdgeCasesFlow(adminCookie, userCookie) {
  // ─── 1. Unauthenticated Requests (401 Unauthorized) ──────────────────────
  // Clear any cookies from k6's default jar so requests are truly unauthenticated
  const jar = http.cookieJar();
  jar.clear(BASE_URL);

  const unauthNotes = get('/api/notes', {
    tags: { name: 'GET /api/notes (no auth)' },
  });
  check(unauthNotes, {
    'unauth GET /api/notes is 401': (r) => r.status === 401,
  });

  const unauthRole = get('/api/users/me/role', {
    tags: { name: 'GET /api/users/me/role (no auth)' },
  });
  check(unauthRole, {
    'unauth GET /api/users/me/role is 401': (r) => r.status === 401,
  });

  const unauthAudit = get('/api/admin/audit-logs', {
    tags: { name: 'GET /api/admin/audit-logs (no auth)' },
  });
  check(unauthAudit, {
    'unauth GET /api/admin/audit-logs is 401': (r) => r.status === 401,
  });

  // ─── 2. Non-existent Resources (404 Not Found) ───────────────────────────
  const notFoundRoute = get('/api/definitely-not-a-real-route', {
    tags: { name: 'GET /api/404-route' },
  });
  check(notFoundRoute, {
    'unknown route returns 404': (r) => r.status === 404,
  });

  if (adminCookie) {
    const notFoundNote = patch('/api/notes/nonexistent_id_9999999999', { title: 'Ghost' }, {
      cookie: adminCookie,
      tags: { name: 'PATCH /api/notes/:id (404)' },
    });
    check(notFoundNote, {
      'patch non-existent note returns 404': (r) => r.status === 404,
    });
  }

  // ─── 3. Validation Failures (400 Bad Request) ────────────────────────────
  if (adminCookie) {
    const badNote = post('/api/notes', { title: '' }, {
      cookie: adminCookie,
      tags: { name: 'POST /api/notes (empty title 400)' },
    });
    check(badNote, {
      'empty note title returns 400': (r) => r.status === 400,
    });

    const badAudit = post('/api/audit-logs', { action: 'hacked_action' }, {
      cookie: adminCookie,
      tags: { name: 'POST /api/audit-logs (illegal action 400)' },
    });
    check(badAudit, {
      'illegal audit action returns 400': (r) => r.status === 400,
    });

    const badRateLimit = post('/api/rate-limit/check', { scope: 'forbidden' }, {
      cookie: adminCookie,
      tags: { name: 'POST /api/rate-limit/check (illegal scope 400)' },
    });
    check(badRateLimit, {
      'illegal rate limit scope returns 400': (r) => r.status === 400,
    });
  }

  // ─── 4. RBAC Authorization Rejection (403 Forbidden) ──────────────────────
  // Regular users have role "user" which lacks permissions for creating or deleting notes
  const targetUserCookie = userCookie;
  if (targetUserCookie) {
    const forbiddenCreate = post('/api/notes', { title: 'Forbidden', content: 'Test' }, {
      cookie: targetUserCookie,
      tags: { name: 'POST /api/notes (user role 403)' },
    });
    check(forbiddenCreate, {
      'regular user cannot create notes (403)': (r) => r.status === 403,
    });

    const forbiddenDelete = del('/api/notes/any-id-forbidden', {
      cookie: targetUserCookie,
      tags: { name: 'DELETE /api/notes/:id (user role 403)' },
    });
    check(forbiddenDelete, {
      'regular user cannot delete notes (403)': (r) => r.status === 403,
    });
  }

  return true;
}
