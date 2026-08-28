import { nestConfig } from '@repo/jest-config';
import type { Config } from 'jest';

export default {
  ...nestConfig,
  rootDir: '.',
  moduleNameMapper: {
    '^@repo/roles$': '<rootDir>/../roles/src/index.ts',
    '^@repo/database$': '<rootDir>/test/stubs/database.stub.ts',
    '^better-auth$': '<rootDir>/test/stubs/better-auth.stub.ts',
    '^ioredis$': '<rootDir>/test/stubs/ioredis.stub.ts',
  },
} satisfies Config;
