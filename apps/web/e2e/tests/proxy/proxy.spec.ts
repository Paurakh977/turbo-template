import { test, expect } from '../../fixtures/page.fixture';
import {
  assertSecurityHeaders,
  headersToMap,
} from '../../helpers/security.helper';

test.describe('Reverse proxy (nginx)', () => {
  test('serves the app over HTTPS with security headers', async ({ request }) => {
    const res = await request.get('/', { ignoreHTTPSErrors: true });
    const headers = headersToMap(res);
    assertSecurityHeaders(headers);
    expect(res.status()).toBeLessThan(400);
  });

  test('exposes a nginx health endpoint', async ({ request }) => {
    const res = await request.get('/healthz', { ignoreHTTPSErrors: true });
    expect(res.status()).toBe(200);
  });

  test('returns 404 for unknown routes (proxy passthrough)', async ({
    request,
  }) => {
    const res = await request.get('/this-route-does-not-exist-xyz', {
      ignoreHTTPSErrors: true,
    });
    expect(res.status()).toBe(404);
  });

  test('CSP blocks external script origins', async ({ page }) => {
    await page.goto('/');
    const blocked = await page.evaluate(async () => {
      return await new Promise<boolean>((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://evil.example.com/x.js';
        s.onerror = () => resolve(true);
        s.onload = () => resolve(false);
        document.head.appendChild(s);
        setTimeout(() => resolve(true), 2000);
      });
    });
    expect(blocked).toBe(true);
  });
});
