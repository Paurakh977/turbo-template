import { test } from '../../fixtures/page.fixture';
import { visualSnapshot } from '../../helpers/screenshot.helper';
import { ROUTES } from '../../config/routes';

test.describe('Visual regression', () => {
  test('auth page snapshot', async ({ page }, testInfo) => {
    if (test.info().project.name !== 'unauthenticated') test.skip();
    await page.goto(ROUTES.auth);
    await visualSnapshot(page, testInfo, 'auth-page', ['[data-toast-kind]']);
  });

  test('dashboard page snapshot', async ({ page }, testInfo) => {
    if (test.info().project.name !== 'user') test.skip();
    await page.goto(ROUTES.dashboard);
    await visualSnapshot(page, testInfo, 'dashboard-page', ['[data-toast-kind]']);
  });

  test('settings page snapshot', async ({ page }, testInfo) => {
    if (test.info().project.name !== 'user') test.skip();
    await page.goto(ROUTES.settings);
    await visualSnapshot(page, testInfo, 'settings-page', ['[data-toast-kind]']);
  });
});
