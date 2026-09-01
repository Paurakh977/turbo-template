import { test as base } from '@playwright/test';
import * as database from '../helpers/database.helper';

type DatabaseFixture = {
  db: typeof database;
};

export const test = base.extend<DatabaseFixture>({
  db: async ({}, use) => {
    await use(database);
  },
});

export const expect = test.expect;
