import { test, expect } from '../../fixtures/page.fixture';
import { ROUTES } from '../../config/routes';
import { E2E } from '../../config/playwright.env';

test.describe('Error handling', () => {
  test('unknown app route shows the not-found page', async ({ page }) => {
    if (test.info().project.name !== 'unauthenticated') test.skip();
    const res = await page.goto(`${ROUTES.base}/no-such-page-e2e`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });

  test('API 404 returns structured JSON, not HTML', async ({ request }) => {
    const res = await request.get('/api/does-not-exist', {
      ignoreHTTPSErrors: true,
    });
    expect(res.status()).toBe(404);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toContain('application/json');
  });

  test('server error in API is not leaked as HTML stack trace', async ({
    request,
  }) => {
    const res = await request.get('/api/health/boom', {
      ignoreHTTPSErrors: true,
    });
    if (res.status() >= 500) {
      const body = (await res.text()) ?? '';
      expect(body.toLowerCase()).not.toContain('at ');
    }
  });
});
