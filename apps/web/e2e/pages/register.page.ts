import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class RegisterPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.auth);
    // Ensure we are in sign-up mode.
    await this.page.getByTestId('auth-toggle-mode').click();
  }

  get nameInput() {
    return this.page.locator('#auth-name');
  }
  get emailInput() {
    return this.page.locator('#auth-email');
  }
  get passwordInput() {
    return this.page.locator('#auth-password');
  }
  get confirmInput() {
    return this.page.locator('#auth-confirm-password');
  }
  get submitButton() {
    return this.page.getByTestId('auth-submit');
  }
  get error() {
    return this.page
      .locator(
        '[data-testid="auth-error"], #auth-password-error, #auth-email-error, #auth-name-error',
      )
      .first();
  }

  async register(name: string, email: string, password: string) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(text?: string) {
    await expect(this.error).toBeVisible();
    if (text) await expect(this.error).toContainText(text);
  }
}
