import { setDefaultResultOrder } from 'node:dns';
import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/config/playwright.env';
import { STORAGE_STATE_FILE } from './e2e/config/users';

// Nginx (docker) listens on IPv4 only; Node's fetch otherwise resolves
// `localhost` to IPv6 `::1` and times out on API-request tests. Force IPv4 so
// all node-side requests (API client, health, proxy, security, rbac, ...) hit
// 127.0.0.1. Browsers do their own DNS and are unaffected.
setDefaultResultOrder('ipv4first');

/**
 * Playwright runs on the host/CI runner and drives the **real** stack through
 * Nginx (https://localhost:8443). Storage states are produced by scripts/seed.ts
 * during globalSetup so each role project starts already authenticated.
 */
export default defineConfig({
  testDir: './e2e/tests',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['html', { open: 'never', host: '0.0.0.0' }],
    ['list'],
  ],
  use: {
    baseURL: E2E.baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    launchOptions: {
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
      ],
    },
  },
  globalSetup: './e2e/global.setup.ts',
  globalTeardown: './e2e/global.teardown.ts',
  projects: [
    {
      name: 'user',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE_FILE('user') },
    },
    {
      name: 'operator',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE_FILE('operator') },
    },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE_FILE('admin') },
    },
    {
      name: 'superadmin',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE_FILE('superAdmin') },
    },
    {
      name: 'unauthenticated',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], storageState: STORAGE_STATE_FILE('operator') },
    },
  ],
});
