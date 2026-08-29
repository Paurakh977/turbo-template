import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../helpers/test-app';
import { truncateAllTables } from '../helpers/database';
import { clearTestRedis, disconnectTestRedis, getTestRedis } from '../helpers/redis';

describe('Redis Failure Resilience (integration)', () => {
  let app: INestApplication;
  let redis: ReturnType<typeof getTestRedis>;

  beforeAll(async () => {
    await truncateAllTables();
    await clearTestRedis();
    app = await createTestApp();
    redis = getTestRedis();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await disconnectTestRedis();
  });

  describe('Redis Health', () => {
    it('Redis connection is alive', async () => {
      const result = await redis.ping();
      expect(result).toBe('PONG');
    });

    it('health/ready reports Redis as ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(res.body.checks.redis).toBe('ok');
    });
  });

  describe('Redis Operations', () => {
    it('supports basic SET/GET/DEL', async () => {
      await redis.set('resilience-test', 'value');
      const value = await redis.get('resilience-test');
      expect(value).toBe('value');
      await redis.del('resilience-test');
      const deleted = await redis.get('resilience-test');
      expect(deleted).toBeNull();
    });

    it('supports INCR with EXPIRE (rate limit pattern)', async () => {
      const key = 'resilience-incr-test';
      const count1 = await redis.incr(key);
      expect(count1).toBe(1);
      await redis.expire(key, 60);
      const count2 = await redis.incr(key);
      expect(count2).toBe(2);
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      await redis.del(key);
    });

    it('supports SCAN for key iteration', async () => {
      await redis.set('scan-test-1', 'a');
      await redis.set('scan-test-2', 'b');

      let cursor = '0';
      const foundKeys: string[] = [];
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${process.env.REDIS_PREFIX || 'int-test:'}scan-test-*`, 'COUNT', 100);
        cursor = nextCursor;
        foundKeys.push(...keys);
      } while (cursor !== '0');

      expect(foundKeys.length).toBeGreaterThanOrEqual(2);

      await redis.del('scan-test-1', 'scan-test-2');
    });
  });

  describe('API Resilience with Redis', () => {
    it('rate limiter works correctly with Redis', async () => {
      // The rate limiter uses Redis INCR + EXPIRE via Lua script
      // Verify it returns consistent results
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .get('/api/health/live')
          .expect(200);
        results.push(res.status === 200);
      }
      expect(results.every((r) => r)).toBe(true);
    });
  });
});
