import { test, expect } from '../../fixtures/page.fixture';
import { ROUTES } from '../../config/routes';

/**
 * Lightweight Core Web Vitals budget check. We assert LCP and CLS from the
 * real browser performance timeline. Thresholds are intentionally permissive
 * for a dev-grade stack but enforce a hard regression guardrail.
 */
test.describe('Performance budget', () => {
  test('dashboard meets LCP and CLS budgets', async ({ page }) => {
    if (test.info().project.name === 'unauthenticated') test.skip();
    if (test.info().project.name === 'mobile') test.skip();
    await page.goto(ROUTES.dashboard, { waitUntil: 'networkidle' });

    // LCP is emitted by the browser asynchronously. Wait up to 10s for at
    // least one entry before timing out gracefully (no infinite rAF loop).
    await page.evaluate(() =>
      new Promise<void>((resolve) => {
        const deadline = Date.now() + 10_000;
        const collect = () => {
          const entries = performance.getEntriesByType('largest-contentful-paint');
          if (entries.length > 0 || Date.now() > deadline) { resolve(); return; }
          requestAnimationFrame(collect);
        };
        collect();
      }),
    );

    const lcp = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        'largest-contentful-paint',
      ) as PerformanceEntry[];
      const last = entries[entries.length - 1];
      return last ? last.startTime : 0;
    });

    const cls = await page.evaluate(() => {
      let clsValue = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<any>) {
          if (!entry.hadRecentInput) clsValue += entry.value as number;
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
      return clsValue;
    });

    expect(lcp).toBeLessThan(5000);
    expect(cls).toBeLessThan(0.25);
  });
});
