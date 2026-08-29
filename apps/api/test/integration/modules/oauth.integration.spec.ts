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

function extractQueryToken(url: string): string {
  const m = url.match(/[?&]token=([^&"'\s]+)/);
  if (!m) throw new Error(`No token in url: ${url}`);
  return decodeURIComponent(m[1]);
}

/** Verifies a freshly signed-up local account using the captured verification email. */
async function verifyLocalAccount(app: INestApplication, email: string): Promise<void> {
  const store = (globalThis as unknown as { __sentEmails?: { to: string; html: string }[] })
    .__sentEmails;
  const mail = (store ?? []).reverse().find((e) => e.to === email);
  if (!mail) throw new Error(`No verification email captured for ${email}`);
  const token = extractQueryToken(mail.html);
  const verify = await request(app.getHttpServer())
    .get('/api/auth/verify-email')
    .query({ token, callbackURL: 'http://localhost:3000/dashboard' });
  expect([200, 302]).toContain(verify.status);
}

function startOAuth(
  app: INestApplication,
  callbackURL = 'http://localhost:3000/dashboard',
): Promise<{ url: string; cookies: string[] }> {
  return request(app.getHttpServer())
    .post('/api/auth/sign-in/social')
    .send({ provider: 'dummy', callbackURL })
    .then((res) => {
      const url = (res.body?.url as string | undefined) ?? (res.headers['location'] as string);
      const setCookie = (res.headers['set-cookie'] as string[] | string | undefined) ?? [];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      return { url, cookies };
    });
}

function stateFromLocation(location: string): string {
  const m = location.match(/[?&]state=([^&]+)/);
  if (!m) throw new Error(`No state in OAuth redirect: ${location}`);
  return decodeURIComponent(m[1]);
}

function completeOAuth(
  app: INestApplication,
  state: string,
  cookies: string[],
  code: string,
): Promise<{ res: Awaited<ReturnType<typeof request>>; sessionCookie?: string }> {
  return request(app.getHttpServer())
    .get('/api/auth/callback/dummy')
    .query({ state, code })
    .set('Cookie', cookies)
    .then((res) => ({
      res,
      sessionCookie: cookieOf(res as unknown as { headers: Record<string, unknown> }),
    }));
}

describe('OAuth & Account Linking (integration)', () => {
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

  it('creates a new user and a session via the dummy OAuth provider', async () => {
    const email = `oauth-${Date.now()}@test.com`;

    const { url, cookies } = await startOAuth(app);
    expect(url).toContain('127.0.0.1:3001/api/dummy/authorize');
    const state = stateFromLocation(url);

    const { res, sessionCookie } = await completeOAuth(app, state, cookies, email);
    expect([200, 302]).toContain(res.status);
    expect(sessionCookie).toBeDefined();

    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', sessionCookie!);
    expect(session.status).toBe(200);
    expect(session.body.user?.email).toBe(email);
  });

  it('links a dummy OAuth identity to an existing verified local account', async () => {
    const email = `link-${Date.now()}@test.com`;

    // Verified local account.
    const signup = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({ email, password: TEST_PASSWORD, name: 'Local', callbackURL: '/dashboard' })
      .expect(200);
    expect(cookieOf(signup)).toBeUndefined(); // unverified => no session
    await verifyLocalAccount(app, email);

    const localSession = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    const localSessionCookie = cookieOf(localSession)!;
    const before = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', localSessionCookie);
    const localUserId = before.body.user.id;
    expect(localUserId).toBeDefined();

    // Same email via dummy OAuth => must link, not create a duplicate user.
    const { url, cookies } = await startOAuth(app);
    const state = stateFromLocation(url);
    const { res, sessionCookie } = await completeOAuth(app, state, cookies, email);
    expect([200, 302]).toContain(res.status);
    expect(sessionCookie).toBeDefined();

    const after = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', sessionCookie!);
    expect(after.body.user.id).toBe(localUserId);

    const accounts = await request(app.getHttpServer())
      .get('/api/auth/list-accounts')
      .set('Cookie', sessionCookie!);
    expect(accounts.status).toBe(200);
    const list = (accounts.body.accounts ?? accounts.body) as Array<{ providerId?: string }>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
    const providers = list.map((a) => a.providerId);
    expect(providers).toContain('credential');
    expect(providers).toContain('dummy');
  });

  it('creates a separate new user when the dummy OAuth email is unused', async () => {
    const email = `oauth2-${Date.now()}@test.com`;

    const { url, cookies } = await startOAuth(app);
    const state = stateFromLocation(url);
    const { res, sessionCookie } = await completeOAuth(app, state, cookies, email);
    expect([200, 302]).toContain(res.status);
    expect(sessionCookie).toBeDefined();

    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set('Cookie', sessionCookie!);
    expect(session.status).toBe(200);
    expect(session.body.user?.email).toBe(email);
  });
});
