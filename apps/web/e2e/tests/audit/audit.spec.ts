import { test, expect } from '../../fixtures/page.fixture';
import { AuditPage } from '../../pages/audit.page';
import { signUp } from '../../helpers/auth.helper';
import { makeUser } from '../../factories/user.factory';
import { latestAuditLog } from '../../helpers/audit.helper';
import { ApiClient, cookieFromStorageState } from '../../helpers/api.helper';
import { query } from '../../helpers/database.helper';

function onlySuperAdmin() {
  if (test.info().project.name !== 'superadmin') test.skip();
}

test.describe('Audit logging', () => {
  test('role change is recorded and visible in the audit console', async ({
    page,
  }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const before = await latestAuditLog('role_changed');

    const api = await ApiClient.create(cookieFromStorageState('superadmin'));
    const rows = await query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [u.email],
    );
    const first = rows[0];
    if (!first) throw new Error(`Seeded user ${u.email} not found`);
    await api.setRole(first.id, ['operator']);
    await api.close();

    const after = await latestAuditLog('role_changed');
    expect(after).toBeTruthy();
    expect(before?.id ?? 'none').not.toEqual(after!.id);

    const audit = new AuditPage(page);
    await audit.goto();
    await audit.filterAction('role_changed');
    await audit.expectActionLogged('Role changed');
  });

  test('filtering by action renders the audit table', async ({ page }) => {
    onlySuperAdmin();
    const audit = new AuditPage(page);
    await audit.goto();
    await audit.filterAction('session_revoked');
    await expect(page.locator('table')).toBeVisible();
  });
});
