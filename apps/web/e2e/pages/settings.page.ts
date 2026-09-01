import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class SettingsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.settings, { timeout: 60_000 });
  }

  get toast() {
    return this.page.getByTestId('toast');
  }

  async clickEditProfile() {
    await this.page.getByTestId('settings-edit-profile').click();
  }

  async setDisplayName(name: string) {
    await this.page.getByTestId('settings-name-input').fill(name);
  }

  async saveProfile() {
    await this.page.getByTestId('settings-save-profile').click();
  }

  async changeDisplayName(name: string) {
    await this.clickEditProfile();
    await this.setDisplayName(name);
    await this.saveProfile();
    await expect(this.toast).toContainText(/saved|updated|profile/i, {
      ignoreCase: true,
    });
  }

  async toggleTheme() {
    const isDarkBefore =
      (await this.page.getAttribute('html', 'class'))?.includes('dark') ||
      (await this.page.getAttribute('html', 'data-theme')) === 'dark';
    await this.page.getByTestId('settings-theme-toggle').click();
    await expect
      .poll(async () => {
        const isDarkAfter =
          (await this.page.getAttribute('html', 'class'))?.includes('dark') ||
          (await this.page.getAttribute('html', 'data-theme')) === 'dark';
        return isDarkAfter !== isDarkBefore;
      })
      .toBe(true);
  }

  async runLabs() {
    await this.page.getByTestId('settings-labs-run').click();
  }

  async deleteAccount(password?: string) {
    await this.page.getByTestId('settings-delete-account').click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (password) {
      const passInput = dialog.getByPlaceholder(/confirm password/i);
      if (await passInput.isVisible()) {
        await passInput.fill(password);
      }
    }
    await dialog.getByRole('button', { name: /delete account/i }).click();
  }

  async expectToast(text: string | RegExp) {
    await expect(this.toast).toContainText(text, {
      ignoreCase: true,
      timeout: 15_000,
    });
  }
}
