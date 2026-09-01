import { Page, expect } from '@playwright/test';
import { ROUTES } from '../config/routes';

export class TwoFactorPage {
  constructor(private readonly page: Page) {}

  async goto(methods = 'totp,otp') {
    await this.page.goto(`${ROUTES.twoFactor}?methods=${methods}`);
  }

  get codeInput() {
    return this.page.locator('#two-factor-code');
  }
  get trustDevice() {
    return this.page.locator('#trustDevice');
  }
  get submit() {
    return this.page.getByRole('button', { name: 'Verify' });
  }
  get errorText() {
    return this.page
      .locator('p', { hasText: /invalid|expired|required/i })
      .first();
  }

  async verify(code: string, trust = false) {
    await this.codeInput.fill(code);
    if (trust) await this.trustDevice.check();
    await this.submit.click();
  }

  async expectError() {
    await expect(this.errorText).toBeVisible();
  }
}
