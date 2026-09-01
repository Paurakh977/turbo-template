import { test, expect } from '../../fixtures/page.fixture';
import { AdminPage } from '../../pages/admin.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { signUp } from '../../helpers/auth.helper';
import { makeUser } from '../../factories/user.factory';
import { query } from '../../helpers/database.helper';
import { latestAuditLog } from '../../helpers/audit.helper';

function onlySuperAdmin() {
  if (test.info().project.name !== 'superadmin') test.skip();
}

test.describe('Admin console', () => {
  test('superadmin can change a user role and an audit entry is written', async ({
    page,
  }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const admin = new AdminPage(page);
    await admin.goto();
    await admin.changeRole(u.email, 'operator');
    await admin.expectRole(u.email, 'operator');

    const [{ id: targetId }] = await query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [u.email],
    );
    await expect
      .poll(
        async () => {
          const log = await latestAuditLog('role_changed', { userId: targetId });
          return log !== null;
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();
  });

  test('superadmin can ban a user', async ({ page }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const admin = new AdminPage(page);
    await admin.goto();
    await admin.banUser(u.email);
    const rows = await query<{ banned: boolean }>(
      `SELECT "banned" FROM "user" WHERE email = $1`,
      [u.email],
    );
    expect(rows[0]?.banned).toBe(true);
  });

  test('superadmin can impersonate a user', async ({ page }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const admin = new AdminPage(page);
    await admin.goto();
    await admin.impersonate(u.email);
    // Impersonation surfaces a banner / different context on the dashboard.
    const dash = new DashboardPage(page);
    await dash.goto();
    await expect(
      page.getByText(/impersonat/i).first(),
    ).toBeVisible();
    // Stop impersonating so subsequent tests retain superadmin privileges
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText(/impersonat/i)).toHaveCount(0);
  });

  test('superadmin can revoke a user sessions', async ({ page }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const admin = new AdminPage(page);
    await admin.goto();
    await admin.revokeSessions(u.email);
    const [{ id: targetId }] = await query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [u.email],
    );
    await expect
      .poll(
        async () => {
          const log = await latestAuditLog('sessions_revoked', { userId: targetId });
          return log !== null;
        },
        { timeout: 10_000 },
      )
      .toBeTruthy();
  });

  test('superadmin can remove a user', async ({ page }) => {
    onlySuperAdmin();
    const u = makeUser();
    await signUp(u.name, u.email, u.password);
    const admin = new AdminPage(page);
    await admin.goto();
    await admin.removeUser(u.email);
    await admin.expectNoRow(u.email);
  });
});
