import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis } from '../helpers/redis';

describe('LinksModule (integration)', () => {
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

  describe('GET /api/links', () => {
    it('returns 200 with an array of links', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('each link has id, url, title, description', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links')
        .expect(200);

      for (const link of res.body) {
        expect(link).toHaveProperty('id');
        expect(link).toHaveProperty('url');
        expect(link).toHaveProperty('title');
        expect(link).toHaveProperty('description');
      }
    });

    it('does not require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/links')
        .expect(200);
    });
  });

  describe('GET /api/links/:id', () => {
    it('returns 200 for a valid link ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links/0')
        .expect(200);

      expect(res.body).toHaveProperty('id', 0);
      expect(res.body).toHaveProperty('url');
      expect(res.body).toHaveProperty('title');
    });

    it('returns 404 for an invalid link ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/links/999')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });
  });
});
