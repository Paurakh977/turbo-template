import { test, expect } from '../../fixtures/page.fixture';
import { E2E } from '../../config/playwright.env';
import {
  assertSecurityHeaders,
  assertSessionCookieSecure,
  headersToMap,
  parseSetCookie,
} from '../../helpers/security.helper';
import { signIn } from '../../helpers/auth.helper';
import { flushRateLimits } from '../../helpers/redis.helper';

function onlyUnauthenticated() {
  if (test.info().project.name !== 'unauthenticated') test.skip();
}

test.describe('Security headers & cookies', () => {
  test('all responses carry the expected security headers', async ({
    request,
  }) => {
    const res = await request.get('/auth', { ignoreHTTPSErrors: true });
    assertSecurityHeaders(headersToMap(res));
  });

  test('session cookie is HttpOnly + Secure + SameSite', async () => {
    onlyUnauthenticated();
    let { result } = await signIn(
      E2E.seedAdmin.email,
      E2E.seedAdmin.password,
    );
    if (result.status === 429) {
      await flushRateLimits();
      const retry = await signIn(
        E2E.seedAdmin.email,
        E2E.seedAdmin.password,
      );
      result = retry.result;
    }
    const rawHeaders: string[] =
      typeof (result.headers as any).getSetCookie === 'function'
        ? (result.headers as any).getSetCookie()
        : result.headers.get('set-cookie')
          ? [result.headers.get('set-cookie')!]
          : [];
    const sessionCookieHeader = rawHeaders.find((h) =>
      h.includes('better-auth.session_token'),
    );
    expect(sessionCookieHeader).toBeTruthy();
    assertSessionCookieSecure(parseSetCookie(sessionCookieHeader!));
  });

  test('login error page does not leak stack traces', async ({ page }) => {
    onlyUnauthenticated();
    await page.goto(`/auth`);
    await page.locator('#auth-email').fill('attacker@test.local');
    await page.locator('#auth-password').fill('wrong-pass-123');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toBeVisible();
    const body = await page.content();
    expect(body.toLowerCase()).not.toContain('error:');
  });
});
