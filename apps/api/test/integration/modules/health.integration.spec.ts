import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';

describe('HealthModule (integration)', () => {
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

  describe('GET /api/health/live', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
    });

    it('does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/health/live')
        .expect(200);
    });
  });

  describe('GET /api/health/ready', () => {
    it('returns 200 with status ready when DB and Redis are healthy', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.redis).toBe('ok');
      expect(res.body.checks.database).toBe('ok');
    });

    it('does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);
    });
  });
});
