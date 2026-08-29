import type { Config } from 'jest';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..', '..');
const integrationDir = path.join(root, 'apps/api/test/integration');

const config: Config = {
  rootDir: root,
  testEnvironment: 'node',
  setupFiles: [path.join(integrationDir, 'setup.ts')],
  roots: [integrationDir],
  testRegex: '.*\\.integration\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx|mts)$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        tsconfig: path.join(root, 'apps/api/tsconfig.json'),
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts', '.mts'],
  testTimeout: 30_000,
  maxWorkers: 1,
  verbose: false,
  passWithNoTests: false,
};

export default config;
