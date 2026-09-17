const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const integrationDir = path.join(root, 'apps/api/test/integration');

module.exports = {
  rootDir: root,
  testEnvironment: 'node',
  setupFiles: [path.join(integrationDir, 'setup.oauth.js')],
  roots: [integrationDir],
  testRegex: '.*oauth\\.integration\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx|mts)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: path.join(root, 'apps/api/tsconfig.test.json'),
      },
    ],
  },
  moduleNameMapper: {
    '^@repo/auth$': path.join(root, 'packages/auth/src/index.ts'),
    '^@repo/auth/(.*)$': path.join(root, 'packages/auth/src/shared/$1'),
    '^@repo/database$': path.join(root, 'packages/database/src/index.ts'),
    '^@repo/database/(.*)$': path.join(root, 'packages/database/src/$1'),
    '^@repo/roles$': path.join(root, 'packages/roles/src/index.ts'),
    '^@repo/roles/(.*)$': path.join(root, 'packages/roles/src/$1'),
    '^resend$': path.join(integrationDir, 'helpers/resend-mock.ts'),
  },
  extensionsToTreatAsEsm: ['.ts', '.mts'],
  testTimeout: 30_000,
  maxWorkers: 1,
  verbose: false,
  passWithNoTests: false,
};
