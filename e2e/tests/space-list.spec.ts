import { expect, test } from '@playwright/test';
import { SPACE_URL_RE, appUrl, spaceLinkSelector } from '../helpers/routes';

test.describe('Wiki Space list', () => {
	test('View opens the public-facing space in a new tab without navigating the row', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `View Btn Space ${timestamp}`;
		const route = `view-btn-space-${timestamp}`;

		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceName);
		await page.getByLabel('Route').fill(route);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await expect(page).toHaveURL(SPACE_URL_RE);

		// Back to the list and find the new (published) space row.
		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');
		const row = page
			.locator(spaceLinkSelector())
			.filter({ hasText: spaceName })
			.first();
		await expect(row).toBeVisible({ timeout: 10000 });

		// View opens the reader at the site root (/<route>) in a new tab, and the
		// row must not navigate into the editor (router-link .stop.prevent guard).
		const listUrl = page.url();
		const [popup] = await Promise.all([
			page.waitForEvent('popup'),
			row.getByRole('button', { name: 'View' }).click(),
		]);
		expect(page.url()).toBe(listUrl);
		await popup.waitForLoadState('domcontentloaded').catch(() => {});
		expect(popup.url()).toContain(route);
		await popup.close();
	});
});
