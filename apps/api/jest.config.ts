import { nestConfig } from '@repo/jest-config';
import type { Config } from 'jest';

export default {
  ...nestConfig,
  moduleNameMapper: {
    // ESM-only package (no CJS entry in its exports map) - jest's CJS runtime
    // cannot parse it. Tests never exercise its internals; see
    // test/stubs/thallesp-better-auth.stub.ts.
    '^@thallesp/nestjs-better-auth$':
      '<rootDir>/../test/stubs/thallesp-better-auth.stub.ts',
  },
} satisfies Config;
