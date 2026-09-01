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
 */
export async function visualSnapshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  maskSelectors: string[] = [],
): Promise<void> {
  const masks = maskSelectors.map((s) => page.locator(s));
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
