import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class AuditPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.audit);
  }

  async filterAction(action: string) {
    await this.page.getByLabel(/action/i).selectOption(action.toLowerCase());
  }

  async search(q: string) {
    await this.page.getByRole('searchbox').fill(q);
  }

  async expectActionLogged(label: string) {
    await expect(
      this.page.getByRole('table').getByText(label, { exact: false }).first(),
    ).toBeVisible();
  }
}
