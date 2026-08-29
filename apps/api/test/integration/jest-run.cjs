// Cross-platform wrapper: sets NODE_OPTIONS for ESM support, then runs jest.
process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --experimental-vm-modules';
require('child_process').execSync('npx jest --config ./test/integration/jest-integration.config.ts --runInBand --forceExit --detectOpenHandles', {
  cwd: __dirname + '/../..',
  stdio: 'inherit',
});
