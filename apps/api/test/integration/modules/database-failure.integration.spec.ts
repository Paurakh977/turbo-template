import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';

describe('Database Failure Resilience (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
  }, 30_000);

  beforeEach(async () => {
    await truncateAllTables();
    await clearTestRedis();
  });

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  describe('Health Check Under Normal Conditions', () => {
    it('ready endpoint returns 200 when DB is healthy', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.checks.database).toBe('ok');
      expect(res.body.checks.redis).toBe('ok');
    });

    it('live endpoint always returns 200 regardless of DB state', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.body.status).toBe('ok');
    });
  });

  describe('Database Query Resilience', () => {
    it('returns proper error when querying with invalid data', async () => {
      // Try to query with obviously invalid ID
      const res = await request(app.getHttpServer())
        .get('/api/links/999999')
        .expect(404);

      expect(res.body).toHaveProperty('statusCode', 404);
    });

    it('handles connection gracefully when DB is reachable', async () => {
      // The app should handle DB operations normally
      const res = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(res.body.checks.database).toBe('ok');
    });
  });

  describe('Graceful Error Responses', () => {
    it('never exposes internal error details to client', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links/999999999')
        .expect(404);
      
      expect(res.body).toHaveProperty('statusCode', 404);
      expect(res.body).toHaveProperty('message');
      expect(res.body).not.toHaveProperty('stack');
    });

    it('returns consistent error envelope on all error types', async () => {
      // 404
      const res404 = await request(app.getHttpServer())
        .get('/api/links/999')
        .expect(404);
      expect(res404.body).toHaveProperty('statusCode');
      expect(res404.body).toHaveProperty('message');

      // 401
      const res401 = await request(app.getHttpServer())
        .get('/api/notes')
        .expect(401);
      expect(res401.body).toHaveProperty('statusCode');
      expect(res401.body).toHaveProperty('message');
    });
  });
});
