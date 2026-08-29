import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';

const TEST_PASSWORD = 'TestPassword123!';

function cookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const all = res.headers['set-cookie'];
  if (!all) return undefined;
  const arr = Array.isArray(all) ? all : [all];
  return arr.find(
    (c: string) =>
      c.toLowerCase().includes('better-auth.session_token') &&
      !c.toLowerCase().includes('max-age=0'),
  );
}

/** Extracts the verification/password-reset token from a sent email. */
function extractToken(html: string): string {
  // Email-verification links use ?token=...; reset-password links embed the
  // token as a path segment (/reset-password/<token>?callbackURL=...).
  const query = html.match(/[?&]token=([^"'&>\s]+)/);
  if (query) return decodeURIComponent(query[1]);
  const path = html.match(/\/reset-password\/([^"?]+)/);
  if (path) return decodeURIComponent(path[1]);
  throw new Error(`No token in email: ${html.slice(0, 200)}`);
}

function lastEmailTo(email: string): { to: string; html: string } | undefined {
  const store = (globalThis as unknown as { __sentEmails?: { to: string; html: string }[] })
    .__sentEmails;
  if (!store) return undefined;
  return [...store].reverse().find((e) => e.to === email);
}

describe('Email Verification & Password Reset (strict, integration)', () => {
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
    (globalThis as unknown as { __sentEmails: { to: string; html: string }[] }).__sentEmails = [];
  });

  it('does NOT issue a session on sign-up until email is verified', async () => {
    const email = `verify-${Date.now()}@test.com`;
    const signup = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: TEST_PASSWORD, name: 'Verify', callbackURL: '/dashboard' })
      .expect(200);

    // No session cookie is set for an unverified user.
    expect(cookieOf(signup)).toBeUndefined();

    // Sign-in is blocked while unverified.
    const signin = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD });
    expect(signin.status).not.toBe(200);

    // A protected route without a session is 401.
    await request(app.getHttpServer()).get('/api/notes').expect(401);
  });

  it('completes the email-verification flow and then grants a session', async () => {
    const email = `verify-flow-${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: TEST_PASSWORD, name: 'VF', callbackURL: '/dashboard' })
      .expect(200);

    const mail = lastEmailTo(email);
    expect(mail).toBeDefined();
    const token = extractToken(mail!.html);

    const verify = await request(app.getHttpServer())
      .get('/api/auth/verify-email')
      .query({ token, callbackURL: 'http://localhost:3000/dashboard' });
    // better-auth verifies then redirects to the callback URL.
    expect([200, 302]).toContain(verify.status);

    // Now sign-in succeeds and yields a session.
    const signin = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    expect(cookieOf(signin)).toBeDefined();

    const notes = await request(app.getHttpServer())
      .get('/api/notes')
      .set('Cookie', cookieOf(signin)!)
      .expect(200);
    expect(Array.isArray(notes.body.notes)).toBe(true);
  });

  it('completes the password-reset flow and invalidates the old password', async () => {
    const email = `reset-${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: TEST_PASSWORD, name: 'Reset', callbackURL: '/dashboard' })
      .expect(200);

    // Verify the account first so sign-in is possible at all.
    const vmail = lastEmailTo(email);
    expect(vmail).toBeDefined();
    const vtoken = extractToken(vmail!.html);
    const verify = await request(app.getHttpServer())
      .get('/api/auth/verify-email')
      .query({ token: vtoken, callbackURL: 'http://localhost:3000/dashboard' });
    expect([200, 302]).toContain(verify.status);

    // Request a password reset.
    await request(app.getHttpServer())
      .post('/api/auth/request-password-reset')
      .send({ email, redirectTo: 'http://localhost:3000/reset-password' })
      .expect(200);

    const rmail = lastEmailTo(email);
    expect(rmail).toBeDefined();
    const rtoken = extractToken(rmail!.html);
    const newPassword = 'BrandNewPassword456!';

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ newPassword, token: rtoken })
      .expect(200);

    // New password works.
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: newPassword })
      .expect(200);

    // Old password is rejected.
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);
  });
});
