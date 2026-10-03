import { existsSync } from 'node:fs';
import { Page, TestInfo, expect } from '@playwright/test';

/**
 * Capture a screenshot and attach it to the HTML report. Used on failure and
 * for the visual-regression baseline step.
 */
export async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${name}.png`, {
    path,
    contentType: 'image/png',
  });
}

/**
 * Mask dynamic regions so visual snapshots are stable across runs.
 * Pass additional selectors (e.g. avatars, timestamps) to mask.
 *
 * Baselines are inherently per-platform — Playwright appends the platform
 * (`-linux`, `-darwin`, `-win32`) to the snapshot filename. The template ships
 * the `-win32` set only, so on any other platform the snapshot would simply be
 * missing and `toHaveScreenshot` would fail with "A snapshot doesn't exist".
 * That would make `pnpm test:e2e` red out of the box for every non-Windows user.
 *
 * So: when no baseline exists for the current platform, skip with an explicit
 * message instead of failing, and tell the user how to generate one. Where a
 * baseline DOES exist (the platform the template was captured on) the assertion
 * runs normally and keeps enforcing pixel stability.
 */
export async function visualSnapshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  maskSelectors: string[] = [],
): Promise<void> {
  const masks = maskSelectors.map((s) => page.locator(s));
  const baseline = testInfo.snapshotPath(`${name}.png`);

  if (!existsSync(baseline)) {
    console.warn(
      `[visual] no baseline for ${name}.png on ${process.platform} — skipping. ` +
        `Generate one with: pnpm --filter web exec playwright test --update-snapshots`,
    );
    testInfo.skip(true, `no ${process.platform} baseline for ${name}.png`);
  }

  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: masks,
  });
  // Also capture a full screenshot to the report for manual inspection.
  const out = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await testInfo.attach(`${name}.png`, {
    path: out,
    contentType: 'image/png',
  });
}
