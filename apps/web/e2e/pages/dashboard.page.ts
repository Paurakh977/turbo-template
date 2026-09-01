import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.dashboard);
  }

  get heading() {
    return this.page.getByRole('heading', { level: 1 });
  }

  async expectGreeting(name?: string) {
    await expect(this.page).toHaveURL(new RegExp(ROUTES.dashboard), { timeout: 15000 });
    await expect(this.heading).toBeVisible({ timeout: 15000 });
    if (name) {
      await expect(this.page.getByText(name, { exact: false }).first()).toBeVisible();
    }
  }

  async signOut() {
    await this.page
      .getByRole('button', { name: /sign out|log out|logout/i })
      .first()
      .click();
  }

  async expectSignedOut() {
    await expect(this.page).toHaveURL(new RegExp(ROUTES.auth), { timeout: 15000 });
  }
}
