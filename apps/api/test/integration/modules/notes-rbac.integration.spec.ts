import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { USER_FIXTURES, seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi, loginUserViaApi } from '../helpers/auth';
import {
  ALL_ROLES,
  API_ENDPOINTS,
  canAccessEndpoint,
} from '../helpers/rbac-matrix';

const TEST_PASSWORD = 'TestPassword123!';

type Agent = { cookie: string };

/**
 * Creates a user with a specific role via Better Auth signup then promotes the
 * role directly in the DB (simulates an admin granting a role), followed by a
 * fresh sign-in so the resulting session reflects the promoted role.
 *
 * NOTE: Better Auth rate-limits /sign-up/email to 3/60s (customRules) and
 * /sign-in/email to 5/60s. Callers MUST clearTestRedis() between invocations
 * to reset those counters, otherwise later sign-ups 429 and never persist.
 */
async function createUserWithRole(
  app: INestApplication,
  role: string,
): Promise<Agent> {
  const email = `rbac-${role}-${Date.now()}@test.com`;
  const signup = await registerUserViaApi(app, email, TEST_PASSWORD, `RBAC ${role}`);
  const userId = signup.userId;

  // Better Auth lowercases email addresses (superAdmin -> superadmin), and the
  // sign-up may also transform the name; resolve the created row by id, which
  // is guaranteed stable, rather than re-querying by the original-cased email.
  const user = userId
    ? await db.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) {
    throw new Error(
      `User not found after registration (role=${role}, status=${signup.status}, userId=${userId})`,
    );
  }
  await db.user.update({ where: { id: user.id }, data: { role } });

  // Fresh sign-in so the new session carries the promoted role. Use the
  // DB-lowered email returned in the sign-up body to avoid case mismatch.
  const resolvedEmail = (signup.body as { user?: { email?: string } })?.user
    ?.email;
  const login = await loginUserViaApi(
    app,
    resolvedEmail ?? email,
    TEST_PASSWORD,
  );
  if (!login.cookie) {
    throw new Error(`Login failed for ${email} — no session cookie returned`);
  }

  return { cookie: login.cookie };
}

describe('Notes RBAC Permission Matrix (integration)', () => {
  let app: INestApplication;
  const agents: Record<string, Agent> = {};

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();

    // Seed the base fixture users (they are referenced by other endpoints).
    await seedBaseUsers();

    // Create one agent per role ONCE. clearTestRedis() after each creation
    // resets Better Auth's /sign-up/email (3/60s) + /sign-in/email (5/60s)
    // rate-limit counters so later sign-ups/sign-ins are never throttled.
    for (const role of ALL_ROLES) {
      agents[role] = await createUserWithRole(app, role);
      await clearTestRedis();
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  beforeEach(async () => {
    // Reset Redis (rate-limiter counters / secondary-storage) but do NOT
    // truncate tables — truncation would invalidate the sessions created in
    // beforeAll and force a mass re-sign-up (which trips the rate limiter).
    await clearTestRedis();
  });

  describe.each(ALL_ROLES)('Role: %s', (role) => {
    describe.each(API_ENDPOINTS)('$method $path ($description)', (endpoint) => {
      const shouldHaveAccess = canAccessEndpoint(role, endpoint);

      it(`${role} ${shouldHaveAccess ? 'CAN' : 'CANNOT'} access`, async () => {
        const agent = agents[role];
        if (!agent) {
          throw new Error(`Agent for role "${role}" was not created`);
        }

        let req = request(app.getHttpServer())[endpoint.method.toLowerCase() as 'get'](
          endpoint.path,
        );
        req = req.set('Cookie', agent.cookie);

        if (endpoint.method === 'POST') {
          if (endpoint.path === '/api/notes') {
            req = req.send({ title: 'RBAC Test', content: 'Test' });
          } else if (endpoint.path === '/api/rate-limit/check') {
            req = req.send({
              scope: 'notes:create-note',
              windowMs: 60000,
              max: 10,
            });
          } else if (endpoint.path === '/api/admin/audit-logs') {
            // GET — no body needed.
          }
        }

        if (endpoint.method === 'PATCH') {
          req = req.send({ title: 'Updated' });
        }

        const res = await req;

        if (shouldHaveAccess) {
          // The request must have passed the auth + permission gate. It may
          // be 200/201/204 (success) or 404 (authorized but the placeholder
          // note doesn't exist) — the gate is the thing under test.
          expect([401, 403]).not.toContain(res.status);
        } else {
          // The request must be blocked at the gate: 401 (no/invalid session)
          // or 403 (insufficient permissions).
          expect([401, 403]).toContain(res.status);
        }
      });
    });
  });
});
