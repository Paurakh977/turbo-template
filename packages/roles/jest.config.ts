import { nestConfig } from '@repo/jest-config';
import type { Config } from 'jest';

export default {
  ...nestConfig,
} satisfies Config;
