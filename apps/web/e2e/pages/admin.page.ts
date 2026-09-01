import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class AdminPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.admin);
    // Wait for the admin table to hydrate — ensures the search input is ready
    await this.page.getByTestId('admin-search').waitFor({ state: 'visible', timeout: 15_000 });
  }

  private row(email: string) {
    return this.page.getByTestId('admin-table').getByRole('row').filter({
      hasText: email,
    });
  }

  async search(email: string) {
    await this.page.getByTestId('admin-search').fill(email);
    await expect(this.row(email)).toBeVisible();
  }

  async expectRow(email: string) {
    await expect(this.row(email)).toBeVisible();
  }

  async expectNoRow(email: string) {
    await expect(this.row(email)).toHaveCount(0);
  }

  async changeRole(email: string, role: string) {
    await this.search(email);
    await this.row(email).locator('select').selectOption(role);
  }

  async expectRole(email: string, role: string) {
    await this.search(email);
    await expect(this.row(email).locator('select')).toHaveValue(role);
  }

  private async action(email: string, name: RegExp) {
    await this.search(email);
    await this.row(email).getByRole('button', { name }).click();
  }

  async banUser(email: string) {
    await this.action(email, /^ban$/i);
    const dialog = this.page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'Ban user' }).click();
    await expect(this.row(email).getByRole('button', { name: /unban/i })).toBeVisible();
  }

  async impersonate(email: string) {
    await this.action(email, /impersonate/i);
    const dialog = this.page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /impersonate/i }).click();
    await this.page.waitForURL(/\/dashboard/);
  }

  async revokeSessions(email: string) {
    await this.action(email, /revoke/i);
    const dialog = this.page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /revoke/i }).click();
    await expect(this.page.getByText(/sessions revoked/i)).toBeVisible();
  }

  async removeUser(email: string) {
    await this.action(email, /delete|remove/i);
    const dialog = this.page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: /delete|remove/i }).click();
    await expect(this.page.getByText(/removed/i)).toBeVisible();
  }
}
