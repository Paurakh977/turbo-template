import { test, expect } from '../../fixtures/page.fixture';
import { E2E } from '../../config/playwright.env';

test.describe('Rate limiting', () => {
  test('nginx returns 429 when hammering the auth endpoint', async () => {
    const url = `${E2E.baseURL}/api/auth/sign-in/email`;
    let saw429 = false;
    const promises: Promise<Response>[] = [];
    for (let i = 0; i < 40; i++) {
      promises.push(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: E2E.appURL },
          body: JSON.stringify({ email: 'spam@test.local', password: 'x' }),
        }),
      );
    }
    const responses = await Promise.all(promises);
    for (const r of responses) {
      if (r.status === 429) saw429 = true;
    }
    expect(saw429).toBe(true);
  });

  test('better-auth throttles repeated sign-in failures', async () => {
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${E2E.baseURL}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: E2E.appURL },
        body: JSON.stringify({ email: 'throttle@test.local', password: 'bad' }),
      });
      if (res.status === 429) saw429 = true;
    }
    expect(saw429).toBe(true);
  });
});
