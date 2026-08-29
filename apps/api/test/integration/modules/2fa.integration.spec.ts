import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@repo/database';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';
import { generateTotpCode } from '../helpers/totp';

const TEST_PASSWORD = 'TestPassword123!';

function cookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const all = res.headers['set-cookie'];
  if (!all) return undefined;
  const arr = Array.isArray(all) ? all : [all];
  return arr.find((c: string) => c.toLowerCase().includes('better-auth.'));
}

function twoFactorCookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const all = res.headers['set-cookie'];
  if (!all) return undefined;
  const arr = Array.isArray(all) ? all : [all];
  return arr.find((c: string) => c.toLowerCase().includes('two_factor'));
}

describe('Two-Factor Authentication (integration)', () => {
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

  async function enableTotp(email: string) {
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'TOTP User');
    const signupCookie = signup.cookie!;
    const enableRes = await request(app.getHttpServer())
      .post('/api/auth/two-factor/enable')
      .set('Cookie', signupCookie)
      .send({ password: TEST_PASSWORD, method: 'totp' })
      .expect(200);
    // Better Auth only marks 2FA active after a confirming TOTP verify; the
    // activation response issues a fresh (trusted) session cookie.
    const code = generateTotpCode(enableRes.body.totpURI);
    const activateRes = await request(app.getHttpServer())
      .post('/api/auth/two-factor/verify-totp')
      .set('Cookie', signupCookie)
      .send({ code })
      .expect(200);
    const activeCookie = cookieOf(activateRes) ?? signupCookie;
    return { cookie: activeCookie, totpUri: enableRes.body.totpURI as string, backupCodes: enableRes.body.backupCodes as string[] };
  }

  describe('TOTP enable + verify', () => {
    it('enables TOTP and returns a totpURI + backup codes', async () => {
      const { totpUri, backupCodes } = await enableTotp(`totp-${Date.now()}@test.com`);
      expect(totpUri).toContain('otpauth://totp/');
      expect(Array.isArray(backupCodes)).toBe(true);
      expect(backupCodes.length).toBeGreaterThan(0);
    });

    it('blocks sign-in until a valid TOTP code is verified', async () => {
      const email = `totp-gate-${Date.now()}@test.com`;
      const { totpUri } = await enableTotp(email);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const loginCookie = twoFactorCookieOf(loginRes);

      // No authenticated session yet — 2FA step pending.
      const pending = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', loginCookie!)
        .expect(200);
      expect(pending.body).toBeNull();

      const code = generateTotpCode(totpUri);
      const verify = await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-totp')
        .set('Cookie', loginCookie)
        .send({ code })
        .expect(200);
      const authed = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookieOf(verify)!)
        .expect(200);
      expect(authed.body).not.toBeNull();
      expect(authed.body.user.email).toBe(email);
    });

    it('rejects an incorrect TOTP code', async () => {
      const email = `totp-wrong-${Date.now()}@test.com`;
      const { } = await enableTotp(email);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const loginCookie = twoFactorCookieOf(loginRes);

      await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-totp')
        .set('Cookie', loginCookie)
        .send({ code: '000000' })
        .expect(401);
    });
  });

  describe('Backup codes', () => {
    it('allows sign-in via a one-time backup code and rejects reuse', async () => {
      const email = `backup-${Date.now()}@test.com`;
      const { backupCodes } = await enableTotp(email);
      const backupCode = backupCodes[0];

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const loginCookie = twoFactorCookieOf(loginRes);

      const verify = await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-backup-code')
        .set('Cookie', loginCookie)
        .send({ code: backupCode })
        .expect(200);
      expect(cookieOf(verify)).toBeDefined();

      // Same backup code cannot be reused.
      const loginRes2 = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/two-factor/verify-backup-code')
        .set('Cookie', twoFactorCookieOf(loginRes2)!)
        .send({ code: backupCode })
        .expect(401);
    });
  });

  describe('Disable', () => {
    it('disables 2FA so sign-in creates a session directly', async () => {
      const email = `totp-disable-${Date.now()}@test.com`;
      const { cookie } = await enableTotp(email);

      await request(app.getHttpServer())
        .post('/api/auth/two-factor/disable')
        .set('Cookie', cookie)
        .send({ password: TEST_PASSWORD })
        .expect(200);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const authed = await request(app.getHttpServer())
        .get('/api/auth/get-session')
        .set('Cookie', cookieOf(loginRes)!)
        .expect(200);
      expect(authed.body).not.toBeNull();
    });
  });
});
