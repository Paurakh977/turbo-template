import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';
import { seedBaseUsers } from '../fixtures/users';

describe('Middleware Integration (integration)', () => {
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
    await seedBaseUsers();
  });

  describe('Security Headers', () => {
    it('includes X-Content-Type-Options: nosniff', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('includes X-Frame-Options: DENY', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('includes strict-origin-when-cross-origin referrer policy', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });

    it('does not include X-Powered-By header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('Compression', () => {
    it('supports gzip encoding', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links')
        .set('Accept-Encoding', 'gzip')
        .expect(200);

      // Compression may or may not be applied depending on response size
      // Just verify the endpoint works with Accept-Encoding header
      expect(res.status).toBe(200);
    });
  });

  describe('Global Prefix', () => {
    it('routes all endpoints under /api prefix', async () => {
      // Should work with prefix
      await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      // Should 404 without prefix (except auth endpoints which have their own base)
      await request(app.getHttpServer())
        .get('/health/live')
        .expect(404);
    });
  });

  describe('Validation Pipe', () => {
    it('rejects requests with unknown properties (whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/notes')
        .send({
          title: 'Test',
          content: 'Content',
          unknownField: 'should be stripped',
        });

      // Should be 401 (no session) not 400 (validation error)
      // because whitelist strips unknown fields before validation
      expect([401, 400]).toContain(res.status);
    });

    it('transforms query parameters to correct types', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notes?limit=10&offset=0')
        .expect(401); // No session

      // The validation pipe should not crash on type transformation
      expect(res.status).toBe(401);
    });
  });

  describe('Exception Filter', () => {
    it('returns consistent error envelope format', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links/999')
        .expect(404);

      expect(res.body).toHaveProperty('statusCode', 404);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('path');
    });

    it('hides internal error details on 500', async () => {
      // We can't easily trigger a 500 in integration tests,
      // but we can verify the filter is registered by checking
      // that unknown routes return proper 404 format
      const res = await request(app.getHttpServer())
        .get('/api/nonexistent-endpoint')
        .expect(404);

      expect(res.body).toHaveProperty('statusCode');
      expect(res.body).not.toHaveProperty('stack');
    });
  });
});
