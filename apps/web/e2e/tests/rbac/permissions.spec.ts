import { test, expect } from '../../fixtures/page.fixture';
import { ApiClient, cookieFromStorageState } from '../../helpers/api.helper';
import { canActOn } from '../../helpers/permissions.helper';
import { ROUTES } from '../../config/routes';

test.describe('RBAC enforcement', () => {
  test('plain user is forbidden from admin audit-log API', async () => {
    if (test.info().project.name !== 'user') test.skip();
    const api = await ApiClient.create(cookieFromStorageState('user'));
    const res = await api.listAuditLogs();
    expect(res.status).toBe(403);
    await api.close();
  });

  test('superadmin can read audit-log API', async () => {
    if (test.info().project.name !== 'user') test.skip();
    const api = await ApiClient.create(cookieFromStorageState('superadmin'));
    const res = await api.listAuditLogs();
    expect(res.status).toBe(200);
    await api.close();
  });

  test('plain user can list notes but not create them', async () => {
    if (test.info().project.name !== 'user') test.skip();
    const api = await ApiClient.create(cookieFromStorageState('user'));
    expect((await api.listNotes()).status).toBe(200);
    expect((await api.createNote('t', 'c')).status).toBe(403);
    await api.close();
  });

  test('navigating to /admin as a user redirects away', async ({ page }) => {
    if (test.info().project.name !== 'user') test.skip();
    await page.goto(ROUTES.admin);
    await expect(page).not.toHaveURL(new RegExp(ROUTES.admin));
  });

  test('canActOn mirrors the role hierarchy', async () => {
    expect(canActOn('superAdmin', 'admin')).toBe(true);
    expect(canActOn('admin', 'user')).toBe(true);
    expect(canActOn('user', 'admin')).toBe(false);
    expect(canActOn('operator', 'operator')).toBe(false);
  });
});
