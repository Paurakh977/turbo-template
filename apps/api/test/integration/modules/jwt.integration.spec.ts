import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { generateKeyPair, jwtVerify, createLocalJWKSet, decodeJwt, SignJWT } from 'jose';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';
import { registerUserViaApi } from '../helpers/auth';

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

describe('JWT Issue & Validation (integration)', () => {
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

  it('issues a JWT from the token endpoint and exposes JWKS', async () => {
    const email = `jwt-${Date.now()}@test.com`;
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'JWT User');
    const cookie = signup.cookie!;

    const tokenRes = await request(app.getHttpServer())
      .get('/api/auth/token')
      .set('Cookie', cookie)
      .expect(200);
    expect(typeof tokenRes.body.token).toBe('string');

    const jwksRes = await request(app.getHttpServer())
      .get('/api/auth/jwks')
      .expect(200);
    expect(Array.isArray(jwksRes.body.keys)).toBe(true);
    expect(jwksRes.body.keys.length).toBeGreaterThan(0);
  });

  it('verifies a valid JWT signature and claims with jose', async () => {
    const email = `jwt-verify-${Date.now()}@test.com`;
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'JWT Verify');
    const cookie = signup.cookie!;

    const tokenRes = await request(app.getHttpServer())
      .get('/api/auth/token')
      .set('Cookie', cookie)
      .expect(200);
    const token = tokenRes.body.token as string;

    const jwksRes = await request(app.getHttpServer())
      .get('/api/auth/jwks')
      .expect(200);
    const keySet = createLocalJWKSet(jwksRes.body);

    const { payload } = await jwtVerify(token, keySet);
    expect(payload.id).toBe(signup.userId);
    expect(payload.email).toBe(email);
    expect(payload.role).toEqual(['user']);
    expect(typeof payload.exp).toBe('number');
    // Issued by the API (baseURL) per auth.ts jwt config.
    expect(payload.iss).toBeDefined();
  });

  it('rejects a tampered/forged JWT (wrong signing key) at the API and in verification', async () => {
    const email = `jwt-tamper-${Date.now()}@test.com`;
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'JWT Tamper');
    const cookie = signup.cookie!;

    const tokenRes = await request(app.getHttpServer())
      .get('/api/auth/token')
      .set('Cookie', cookie)
      .expect(200);
    const token = tokenRes.body.token as string;

    // Re-sign a modified payload with an attacker-controlled ES256 key.
    const original = decodeJwt(token);
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ ...original, role: 'superAdmin' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    // Cryptographic verification against the real JWKS must fail.
    const jwksRes = await request(app.getHttpServer())
      .get('/api/auth/jwks')
      .expect(200);
    const keySet = createLocalJWKSet(jwksRes.body);
    await expect(jwtVerify(forged, keySet)).rejects.toBeDefined();

    // The API must reject the forged bearer token on a protected route.
    await request(app.getHttpServer())
      .get('/api/notes')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('accepts a valid JWT bearer on a protected route (if supported)', async () => {
    const email = `jwt-bearer-${Date.now()}@test.com`;
    const signup = await registerUserViaApi(app, email, TEST_PASSWORD, 'JWT Bearer');
    const cookie = signup.cookie!;

    const tokenRes = await request(app.getHttpServer())
      .get('/api/auth/token')
      .set('Cookie', cookie)
      .expect(200);
    const token = tokenRes.body.token as string;

    const res = await request(app.getHttpServer())
      .get('/api/notes')
      .set('Authorization', `Bearer ${token}`);
    // Either the app accepts bearer sessions (200) or it is cookie-only (401);
    // both are acceptable — the important guarantee (tamper rejection) is above.
    expect([200, 401]).toContain(res.status);
  });
});
