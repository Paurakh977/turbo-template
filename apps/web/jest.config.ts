import { nestConfig } from '@repo/jest-config';
import type { Config } from 'jest';

export default {
  ...nestConfig,
  rootDir: 'src',
  moduleNameMapper: {
    '^@repo/auth$': '<rootDir>/../../../packages/auth/src/index.ts',
    '^@repo/auth/(.*)$': '<rootDir>/../../../packages/auth/src/$1.ts',
    '^@repo/roles$': '<rootDir>/../../../packages/roles/src/index.ts',
    '^@repo/ui$': '<rootDir>/../../../packages/ui/src/index.ts',
    '^@repo/ui/(.*)$': '<rootDir>/../../../packages/ui/src/$1.tsx',
    '^@repo/api$': '<rootDir>/../../../packages/api/src/entry.ts',
    '^server-only$': '<rootDir>/test/stubs/server-only.stub.ts',
  },
} satisfies Config;
