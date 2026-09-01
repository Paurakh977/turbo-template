import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto(ROUTES.auth);
  }

  get emailInput() {
    return this.page.locator('#auth-email');
  }
  get passwordInput() {
    return this.page.locator('#auth-password');
  }
  get submitButton() {
    return this.page.getByTestId('auth-submit');
  }
  get error() {
    return this.page.getByTestId('auth-error');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(text?: string) {
    await expect(this.error).toBeVisible();
    if (text) await expect(this.error).toContainText(text);
  }

  async clickOAuth(provider: 'google' | 'github') {
    await this.page.getByTestId(`auth-${provider}`).click();
  }

  async toggleToSignUp() {
    await this.page.getByTestId('auth-toggle-mode').click();
  }
}
