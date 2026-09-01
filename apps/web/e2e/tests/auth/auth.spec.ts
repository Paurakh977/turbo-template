import { test, expect } from '../../fixtures/page.fixture';
import { LoginPage } from '../../pages/login.page';
import { RegisterPage } from '../../pages/register.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TwoFactorPage } from '../../pages/twofactor.page';
import { E2E } from '../../config/playwright.env';
import { E2E_USERS } from '../../config/users';
import {
  signUp,
  requestPasswordReset,
  resetPassword,
  enableTwoFactor,
  verifyTotp,
} from '../../helpers/auth.helper';
import { makeUser } from '../../factories/user.factory';
import { authenticator } from 'otplib';

authenticator.options = { window: 1 };

import { flushRateLimits } from '../../helpers/redis.helper';

function onlyUnauthenticated() {
  if (test.info().project.name !== 'unauthenticated') test.skip();
}

function onlySuperAdmin() {
  if (test.info().project.name !== 'superadmin') test.skip();
}

test.describe('Authentication flows', () => {
  test.beforeEach(async () => {
    onlyUnauthenticated();
    await flushRateLimits();
  });

  test('sign-in with valid credentials lands on the dashboard', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(E2E_USERS.user.email, E2E_USERS.user.password);
    const dash = new DashboardPage(page);
    await dash.expectGreeting();
  });

  test('sign-in with bad credentials shows an error', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('nobody@test.local', 'wrong-password-123');
    await login.expectError();
  });

  test('sign-up rejects a weak password', async ({ page }) => {
    const reg = new RegisterPage(page);
    await reg.goto();
    await reg.register('Weak User', `weak${Date.now()}@test.local`, 'short');
    await reg.expectError();
  });

  test('OAuth provider buttons are rendered', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(page.getByTestId('auth-google')).toBeVisible();
    await expect(page.getByTestId('auth-github')).toBeVisible();
  });

  test('sign-out returns to the auth page', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(E2E_USERS.user.email, E2E_USERS.user.password);
    const dash = new DashboardPage(page);
    await dash.expectGreeting();
    await dash.signOut();
    await dash.expectSignedOut();
  });
});

test.describe('Password reset', () => {
  test.beforeEach(async () => {
    onlySuperAdmin();
    await flushRateLimits();
  });

  test('request reset -> reset -> login with new password', async ({
    page,
    context,
  }) => {
    const user = makeUser();
    // Create a real account through the API.
    await signUp(user.name, user.email, user.password);

    const { token } = await requestPasswordReset(user.email);
    expect(token).toBeTruthy();

    const newPassword = 'e2e-NewPass-Word-9';
    const reset = await resetPassword(token!, newPassword);
    expect(reset.error).toBeNull();

    // Clear superadmin session cookie so we can log in with the new credentials
    await context.clearCookies();
    const login = new LoginPage(page);
    await login.goto();
    await login.login(user.email, newPassword);
    const dash = new DashboardPage(page);
    await dash.expectGreeting();
  });
});

test.describe('Two-factor authentication', () => {
  test.beforeEach(async () => {
    await flushRateLimits();
  });

  test('enable 2FA returns backup codes and verifies a TOTP', async () => {
    onlySuperAdmin();
    const user = makeUser();
    await signUp(user.name, user.email, user.password);
    const enabled = await enableTwoFactor(
      user.email,
      user.password,
    );
    expect(enabled.backupCodes?.length ?? 0).toBeGreaterThan(0);
    expect(enabled.totpURI).toBeTruthy();

    const code = authenticator.generate(enabled.totpURI!);
    const verify = await verifyTotp(code, false, enabled.cookie);
    expect(verify.error).toBeNull();
  });

  test('2FA page rejects an invalid code', async ({ page }) => {
    onlyUnauthenticated();
    const page2fa = new TwoFactorPage(page);
    await page2fa.goto('totp');
    await page2fa.verify('000000');
    await page2fa.expectError();
  });
});
