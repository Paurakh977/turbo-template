import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
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

describe('Attack Surface (integration)', () => {
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

  it('rejects SQL-injection emails at sign-in without leaking or 500-ing', async () => {
    const payloads = [
      "' OR '1'='1",
      "admin@test.com'--",
      "'; DROP TABLE \"user\";--",
      '1=1 OR 1=1',
    ];
    for (const email of payloads) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'anything' });
      // Clean rejection (validation 400 or auth 401); never a 500 / DB error.
      expect(r.status).not.toBe(500);
      expect([400, 401]).toContain(r.status);
    }
  });

  it('treats SQL-injection in note content as a literal (parameterized queries)', async () => {
    const user = await registerUserViaApi(app, `sqli-${Date.now()}@test.com`, TEST_PASSWORD, 'SQLi', 'operator');
    const cookie = user.cookie!;
    const payload = "'; DROP TABLE \"note\"; DELETE FROM \"user\";--";

    const created = await request(app.getHttpServer())
      .post('/api/notes')
      .set('Cookie', cookie)
      .send({ title: payload, content: payload })
      .expect(201);
    expect(created.body.title).toBe(payload);

    // The injected DROP/DELETE must NOT have executed — list still works and
    // returns the record intact (proves the query is parameterized).
    const list = await request(app.getHttpServer())
      .get('/api/notes')
      .set('Cookie', cookie)
      .expect(200);
    expect(Array.isArray(list.body.notes)).toBe(true);
    expect(list.body.notes.some((n: { title: string }) => n.title === payload)).toBe(true);
  });

  it('stores an XSS payload as a literal string and returns JSON (not HTML)', async () => {
    const user = await registerUserViaApi(app, `xss-${Date.now()}@test.com`, TEST_PASSWORD, 'XSS', 'operator');
    const cookie = user.cookie!;
    const payload = '<script>alert(document.cookie)</script>';

    const created = await request(app.getHttpServer())
      .post('/api/notes')
      .set('Cookie', cookie)
      .send({ title: payload, content: 'hi' })
      .expect(201);
    expect(created.body.title).toBe(payload);

    const list = await request(app.getHttpServer())
      .get('/api/notes')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.stringify(list.body)).toContain(payload);
    // JSON API responses are not rendered as HTML by the browser.
    expect(String(list.headers['content-type'])).toContain('application/json');
  });

  it('locks out brute-force sign-in after the rate-limit threshold (429)', async () => {
    const email = `lock-${Date.now()}@test.com`;
    await registerUserViaApi(app, email, TEST_PASSWORD, 'Lock');

    let locked = false;
    for (let i = 0; i < 6; i++) {
      const r = await request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .send({ email, password: 'wrong-password' });
      if (r.status === 429) {
        locked = true;
        break;
      }
    }
    expect(locked).toBe(true);
  });
});
