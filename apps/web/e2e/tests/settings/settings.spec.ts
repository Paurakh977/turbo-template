import { test, expect } from '../../fixtures/page.fixture';
import { SettingsPage } from '../../pages/settings.page';
import { RegisterPage } from '../../pages/register.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { makeUser } from '../../factories/user.factory';

function onlyCanProfile() {
  const role = test.info().project.name;
  if (!['operator', 'admin', 'superadmin'].includes(role)) test.skip();
}

function onlyCanTheme() {
  const role = test.info().project.name;
  if (!['operator', 'admin', 'superadmin'].includes(role)) test.skip();
}

function onlyCanLabs() {
  const role = test.info().project.name;
  if (!['admin', 'superadmin'].includes(role)) test.skip();
}

function onlyUserRole() {
  if (test.info().project.name !== 'user') test.skip();
}

test.describe('Settings', () => {
  test('toggles the UI theme', async ({ page }) => {
    onlyCanTheme();
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.toggleTheme();
  });

  test('edits the display name', async ({ page }) => {
    onlyCanProfile();
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.changeDisplayName(`E2E ${makeUser().name}`);
  });

  test('runs a labs experiment', async ({ page }) => {
    onlyCanLabs();
    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.runLabs();
    await settings.expectToast(/experiment|labs|run/i);
  });

  test('account deletion requires confirmation and signs the user out', async ({
    page,
    context,
  }) => {
    onlyUserRole();
    // Clear the seeded session cookie so we can register a fresh throwaway account.
    await context.clearCookies();
    const reg = new RegisterPage(page);
    await reg.goto();
    const u = makeUser();
    await reg.register(u.name, u.email, u.password);
    const dash = new DashboardPage(page);
    await dash.expectGreeting();

    const settings = new SettingsPage(page);
    await settings.goto();
    await settings.deleteAccount(u.password);
    await expect(page).toHaveURL(/\/auth/);
  });
});
