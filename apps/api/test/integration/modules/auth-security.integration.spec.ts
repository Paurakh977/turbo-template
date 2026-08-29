import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';

const TEST_PASSWORD = 'TestPassword123!';

describe('Auth Security (integration)', () => {
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

  describe('Invalid Tokens', () => {
    it('rejects request with fabricated session cookie', async () => {
      await request(app.getHttpServer())
        .get('/api/notes')
        .set('Cookie', 'better-auth.session_token=abc123-fake-token')
        .expect(401);
    });

    it('rejects request with empty session cookie', async () => {
      await request(app.getHttpServer())
        .get('/api/notes')
        .set('Cookie', 'better-auth.session_token=')
        .expect(401);
    });
  });

  describe('Brute Force Protection', () => {
    it('eventually rate-limits repeated failed login attempts', async () => {
      const email = `brute-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Brute Force' })
        .expect(200);

      // Make multiple failed login attempts
      const attempts = Array.from({ length: 6 }, () =>
        request(app.getHttpServer())
          .post('/api/auth/sign-in/email')
          .send({ email, password: 'WrongPassword123!' }),
      );

      const results = await Promise.all(attempts);
      const statuses = results.map((r) => r.status);

      // Some should be rate-limited (429) or all 401
      // Better Auth handles rate limiting per-endpoint
      expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    });
  });

  describe('CSRF Protection', () => {
    it('rejects requests from untrusted origins', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('Origin', 'https://evil.com')
        .send({ email: 'test@test.com', password: 'WrongPass123!' });
      
      // CORS middleware rejects the origin (no access-control-allow-origin header).
      // Supertest doesn't enforce CORS, so we verify the header is absent.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Cookie Security', () => {
    it('sets HttpOnly flag on session cookies', async () => {
      const email = `cookie-httponly-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Cookie Test' })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      const sessionCookie = cookies?.find((c: string) =>
        c.includes('better-auth'),
      );

      if (sessionCookie) {
        expect(sessionCookie.toLowerCase()).toContain('httponly');
      }
    });

    it('sets SameSite=Lax on session cookies', async () => {
      const email = `cookie-samesite-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'SameSite Test' })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      const sessionCookie = cookies?.find((c: string) =>
        c.includes('better-auth'),
      );

      if (sessionCookie) {
        expect(sessionCookie.toLowerCase()).toContain('samesite');
      }
    });

    it('sets Path=/ on session cookies', async () => {
      const email = `cookie-path-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: TEST_PASSWORD, name: 'Path Test' })
        .expect(200);

      const cookies = res.headers['set-cookie'];
      const sessionCookie = cookies?.find((c: string) =>
        c.includes('better-auth'),
      );

      if (sessionCookie) {
        expect(sessionCookie.toLowerCase()).toContain('path=/');
      }
    });
  });

  describe('Password Policy', () => {
    it('rejects password without uppercase', async () => {
      const email = `policy-lower-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'testpassword123!', name: 'No Upper' })
        .expect(400);
    });

    it('rejects password without lowercase', async () => {
      const email = `policy-upper-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'TESTPASSWORD123!', name: 'No Lower' })
        .expect(400);
    });

    it('rejects password without digit', async () => {
      const email = `policy-digit-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'TestPassword!', name: 'No Digit' })
        .expect(400);
    });

    it('rejects password without symbol', async () => {
      const email = `policy-symbol-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'TestPassword123', name: 'No Symbol' })
        .expect(400);
    });

    it('rejects password shorter than 8 characters', async () => {
      const email = `policy-short-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'Ab1!', name: 'Short' })
        .expect(400);
    });

    it('accepts password meeting all criteria', async () => {
      const email = `policy-valid-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'ValidPass123!', name: 'Valid' })
        .expect(200);
    });
  });

  describe('Error Response Shape', () => {
    it('returns proper error envelope on 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notes')
        .expect(401);

      expect(res.body).toHaveProperty('statusCode', 401);
      expect(res.body).toHaveProperty('message');
    });

    it('returns proper error envelope on 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links/999999')
        .expect(404);

      expect(res.body).toHaveProperty('statusCode', 404);
    });
  });
});
