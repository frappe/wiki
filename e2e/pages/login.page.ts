import { type Page, expect } from '@playwright/test';

export class LoginPage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto('/login');
		await this.page.waitForLoadState('networkidle');
	}

	async login(email = 'Administrator', password = 'admin') {
		await this.goto();
		await this.page.fill('#login_email', email);
		await this.page.fill('#login_password', password);
		await this.page.click('button.btn-login');
		await this.page.waitForURL(/\/(app|desk|wiki)/, { timeout: 30000 });
	}

	async expectToBeOnLoginPage() {
		await expect(this.page).toHaveURL(/.*login.*/);
	}
}
