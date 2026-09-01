import { test, expect } from '../../fixtures/page.fixture';
import { assertNoA11yViolations } from '../../helpers/accessibility.helper';
import { ROUTES } from '../../config/routes';

test.describe('Accessibility', () => {
  test('auth page has no critical axe violations', async ({ page }) => {
    if (test.info().project.name !== 'unauthenticated') test.skip();
    await page.goto(ROUTES.auth);
    await assertNoA11yViolations(page, { disabledRules: ['color-contrast'] });
  });

  test('dashboard page has no critical axe violations', async ({ page }) => {
    if (test.info().project.name !== 'user') test.skip();
    await page.goto(ROUTES.dashboard);
    await assertNoA11yViolations(page, { disabledRules: ['color-contrast'] });
  });

  test('settings page has no critical axe violations', async ({ page }) => {
    if (test.info().project.name !== 'user') test.skip();
    await page.goto(ROUTES.settings);
    await assertNoA11yViolations(page, { disabledRules: ['color-contrast'] });
  });

  test('admin page has no critical axe violations', async ({ page }) => {
    if (test.info().project.name !== 'superadmin') test.skip();
    await page.goto(ROUTES.admin);
    await assertNoA11yViolations(page, { disabledRules: ['color-contrast'] });
  });
});
