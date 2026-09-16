// k6/scenarios/audit-flow.js
// Tests user client audit writes and admin audit log listings.

import { check } from 'k6';
import { get, post } from '../helpers/http.js';
import { generateAuditPayload } from '../helpers/data.js';

export function runAuditFlow(sessionCookie) {
  if (!sessionCookie) {
    throw new Error('runAuditFlow requires an authenticated sessionCookie');
  }

  // 1. Record Client Audit Event (POST /api/audit-logs)
  const auditPayload = generateAuditPayload();
  const writeRes = post('/api/audit-logs', auditPayload, {
    cookie: sessionCookie,
    tags: { name: 'POST /api/audit-logs' },
  });
  check(writeRes, {
    'record audit log status is 201': (r) => r.status === 201,
  });

  // 2. Query Admin Audit Logs (GET /api/admin/audit-logs)
  const listRes = get('/api/admin/audit-logs?page=1&action=all', {
    cookie: sessionCookie,
    tags: { name: 'GET /api/admin/audit-logs' },
  });
  check(listRes, {
    'list audit logs status is 200': (r) => r.status === 200,
    'audit logs returns data array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data) || Array.isArray(body.logs) || Array.isArray(body);
      } catch {
        return false;
      }
    },
  });

  return {
    writeRes,
    listRes,
  };
}
