import { test as base } from './database.fixture';
import * as redis from '../helpers/redis.helper';

type RedisFixture = {
  redis: typeof redis;
};

export const test = base.extend<RedisFixture>({
  redis: async ({}, use) => {
    await use(redis);
  },
});

export const expect = test.expect;
