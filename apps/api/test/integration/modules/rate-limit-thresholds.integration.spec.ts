import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi, loginUserViaApi } from '../helpers/auth';
import { extractTotpSecret, generateTotpCode } from '../helpers/totp';

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

function twoFactorCookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const all = res.headers['set-cookie'];
  if (!all) return undefined;
  const arr = Array.isArray(all) ? all : [all];
  return arr.find((c: string) => c.toLowerCase().includes('_two_factor'));
}

// Register + enable + activate 2FA, returning a session cookie and the TOTP uri.
async function enableTotp(app: INestApplication, email: string) {
  const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'TOTP');
  const enable = await request(app.getHttpServer())
    .post('/api/auth/two-factor/enable')
    .set('Cookie', signup.cookie!)
    .send({ password: TEST_PASSWORD })
    .expect(200);
  const totpUri = enable.body.totpURI as string;
  const code = generateTotpCode(extractTotpSecret(totpUri));
  const activated = await request(app.getHttpServer())
    .post('/api/auth/two-factor/verify-totp')
    .set('Cookie', signup.cookie!)
    .send({ code })
    .expect(200);
  return { cookie: activated.cookie ?? signup.cookie!, totpUri };
}

describe('Rate Limit Thresholds (integration)', () => {
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

  it('sign-in/email: allows 5 then 429 on the 6th (5 / 60s)', async () => {
    const email = `rl-signin-${Date.now()}@test.com`;
    await registerUserViaApi(app, email, TEST_PASSWORD, 'RL');

    for (let i = 0; i < 5; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD });
      expect(r.status).not.toBe(429);
    }
    const sixth = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD });
    expect(sixth.status).toBe(429);
  });

  it('sign-up/email: allows 3 then 429 on the 4th (3 / 60s)', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/sign-up/email')
        .send({
          email: `rl-signup-${Date.now()}-${i}@test.com`,
          password: TEST_PASSWORD,
          name: 'RL',
          callbackURL: '/dashboard',
        });
      expect(r.status).not.toBe(429);
    }
    const fourth = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .send({
        email: `rl-signup-${Date.now()}-x@test.com`,
        password: TEST_PASSWORD,
        name: 'RL',
        callbackURL: '/dashboard',
      });
    expect(fourth.status).toBe(429);
  });

  it('two-factor/verify-totp: allows 3 then 429 on the 4th (3 / 10s)', async () => {
    const email = `rl-totp-${Date.now()}@test.com`;
    const { cookie, totpUri } = await enableTotp(app, email);

    const challenge = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    const twoFactorCookie = twoFactorCookieOf(challenge)!;

    let limited = false;
    for (let i = 0; i < 4; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-totp')
        .set('Cookie', `${cookie}; ${twoFactorCookie}`)
        .send({ code: generateTotpCode(extractTotpSecret(totpUri)) });
      if (r.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it('admin/set-role: allows 5 then 429 on the 6th (5 / 60s)', async () => {
    const superAdmin = await registerUserViaApi(
      app,
      `rl-sa-${Date.now()}@test.com`,
      TEST_PASSWORD,
      'SA',
    );
    await db.user.update({ where: { id: superAdmin.userId }, data: { role: 'superAdmin' } });
    const saLogin = await loginUserViaApi(app, superAdmin.body.user.email, TEST_PASSWORD);

    const target = await registerUserViaApi(app, `rl-tgt-${Date.now()}@test.com`, TEST_PASSWORD, 'TGT');

    for (let i = 0; i < 5; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/admin/set-role')
        .set('Cookie', saLogin.cookie!)
        .send({ userId: target.userId, role: i % 2 === 0 ? 'admin' : 'user' });
      expect(r.status).not.toBe(429);
    }
    const sixth = await request(app.getHttpServer())
      .post('/api/auth/admin/set-role')
      .set('Cookie', saLogin.cookie!)
      .send({ userId: target.userId, role: 'admin' });
    expect(sixth.status).toBe(429);
  });

  it('admin/remove-user: allows 2 then 429 on the 3rd (2 / 60s)', async () => {
    const superAdmin = await registerUserViaApi(
      app,
      `rl-sa2-${Date.now()}@test.com`,
      TEST_PASSWORD,
      'SA',
    );
    await db.user.update({ where: { id: superAdmin.userId }, data: { role: 'superAdmin' } });
    const saLogin = await loginUserViaApi(app, superAdmin.body.user.email, TEST_PASSWORD);

    const targets = await Promise.all(
      [0, 1, 2].map((i) =>
        registerUserViaApi(app, `rl-rm-${Date.now()}-${i}@test.com`, TEST_PASSWORD, 'T'),
      ),
    );

    for (let i = 0; i < 2; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/admin/remove-user')
        .set('Cookie', saLogin.cookie!)
        .send({ userId: targets[i].userId });
      expect(r.status).not.toBe(429);
    }
    const third = await request(app.getHttpServer())
      .post('/api/auth/admin/remove-user')
      .set('Cookie', saLogin.cookie!)
      .send({ userId: targets[2].userId });
    expect(third.status).toBe(429);
  });
});
