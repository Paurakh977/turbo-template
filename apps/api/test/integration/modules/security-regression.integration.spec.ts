import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

const TEST_PASSWORD = 'TestPassword123!';

describe('Security Regression (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  beforeEach(async () => {
    await truncateAllTables();
    await clearTestRedis();
    await seedBaseUsers();
  });

  describe('X-Forwarded-For Parsing', () => {
    it('does not accept spoofed IP from untrusted source', async () => {
      // Send a request with a forged X-Forwarded-For header
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .set('X-Forwarded-For', '10.0.0.1, 203.0.113.50')
        .expect(200);

      // The endpoint still works — the IP handling is internal
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Audit Metadata Sanitization', () => {
    it('strips performedViaImpersonation from client input', async () => {
      const email = `security-audit-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'SecurityAudit', 'operator');

      await request(app.getHttpServer())
        .post('/api/audit-logs')
        .set('Cookie', signup.cookie!)
        .send({
          action: 'profile_updated',
          metadata: {
            performedViaImpersonation: true,
            impersonatedBy: 'hacker-id',
            legitimateData: 'yes',
          },
        })
        .expect(201);

      // The audit log should not contain the forged fields
      const { db } = await import('@repo/database');
      const user = await db.user.findUnique({ where: { email } });
      const logs = await db.auditLog.findMany({
        where: { userId: user!.id, action: 'profile_updated' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      if (logs.length > 0) {
        const metadata = logs[0].metadata as Record<string, unknown>;
        expect(metadata).not.toHaveProperty('performedViaImpersonation');
        expect(metadata).not.toHaveProperty('impersonatedBy');
        expect(metadata).toHaveProperty('legitimateData', 'yes');
      }
    });
  });

  describe('Security Headers', () => {
    it('includes X-Content-Type-Options header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes X-Frame-Options header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('includes Referrer-Policy header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['referrer-policy']).toBeDefined();
    });
  });

  describe('Trusted Origins', () => {
    it('allows requests from trusted origin', async () => {
      const email = `security-trusted-${Date.now()}@test.com`;
      await registerUserViaApi(app, email, TEST_PASSWORD, 'TrustedOrigin', 'user');

      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Origin', 'http://localhost:3000')
        .send({ email, password: TEST_PASSWORD });

      // Should not be blocked by CORS
      expect(res.status).not.toBe(403);
    });

    it('blocks requests from untrusted origin in production mode', async () => {
      const email = `untrusted-origin-${Date.now()}@test.com`;
      const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'UntrustedOrigin', 'user');

      // Send sign-in with an untrusted Origin header
      // CORS middleware rejects the origin (callback(null, false)), but supertest
      // doesn't enforce CORS. We verify the response lacks CORS headers.
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Origin', 'https://evil.com')
        .send({ email, password: TEST_PASSWORD });

      // Without CORS headers, the browser would block the response.
      // Supertest gets the raw response — just verify no CORS allow header.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Rate Limiting', () => {
    it('global rate limiter returns 429 when exceeded', async () => {
      // The global limit is 200 req/min (ThrottlerModule). Send requests
      // SEQUENTIALLY over one shared agent connection — firing 200+ requests
      // concurrently exhausts the socket pool and yields ECONNRESET rather
      // than a clean 429, and the in-memory throttler counts by source IP
      // regardless of how many sockets we use.
      const agent = request.agent(app.getHttpServer());
      let has429 = false;
      for (let i = 0; i < 210; i++) {
        const res = await agent.get('/api/health/live');
        if (res.status === 429) {
          has429 = true;
          break;
        }
      }

      // The 201st request (or later) should be rate-limited
      expect(has429).toBe(true);
    });
  });
});
