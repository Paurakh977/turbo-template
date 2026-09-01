import { test, expect } from '../../fixtures/page.fixture';
import { NotesPage } from '../../pages/notes.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { ROUTES } from '../../config/routes';

test.describe('Responsive layout', () => {
  test('dashboard renders on mobile viewport', async ({ page }) => {
    if (test.info().project.name !== 'mobile') test.skip();
    const dash = new DashboardPage(page);
    await dash.goto();
    await expect(dash.heading).toBeVisible();
  });

  test('notes page is usable on mobile viewport', async ({ page }) => {
    if (test.info().project.name !== 'mobile') test.skip();
    const notes = new NotesPage(page);
    await notes.goto();
    await notes.openCreate();
    await expect(page.locator('#note-create-title')).toBeVisible();
  });
});
