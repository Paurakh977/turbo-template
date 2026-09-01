import { setDefaultResultOrder } from 'node:dns';
import { type FullConfig } from '@playwright/test';
import { E2E } from './config/playwright.env';
import { runSeed } from './scripts/seed';

setDefaultResultOrder('ipv4first');

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E.baseURL}/api/health/ready`, {
        headers: { Origin: E2E.appURL },
      });
      lastStatus = res.status;
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `API /api/health/ready not ready within timeout (last status ${lastStatus})`,
  );
}

export default async function globalSetup(_config: FullConfig) {
  // eslint-disable-next-line no-console
  console.log('Waiting for API readiness...');
  await waitForHealth();
  // eslint-disable-next-line no-console
  console.log('Seeding E2E accounts + storage states...');
  await runSeed();
}
