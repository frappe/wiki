import { expect, test } from '@playwright/test';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

/**
 * The new-page dialog prefills the route from the title and lets the author
 * overwrite it. Once overwritten, further title edits must not clobber it.
 */
test.describe('Editable page route', () => {
	test('prefills the route from the title, then lets the author take it over', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		await openNewPageDialog(page);

		const dialog = page.getByRole('dialog');
		const titleField = dialog.getByLabel('Title');
		const routeField = dialog.getByLabel('Route');

		// Route tracks the title while it is untouched.
		await titleField.fill('Route Alpha');
		await expect(routeField).toHaveValue(/route-alpha$/);

		await titleField.fill('Route Beta');
		await expect(routeField).toHaveValue(/route-beta$/);

		// Once edited by hand it stops tracking.
		const customRoute = `custom-route-${Date.now()}`;
		await routeField.fill(customRoute);
		await titleField.fill('Route Gamma');
		await expect(routeField).toHaveValue(customRoute);

		await dialog.getByRole('button', { name: 'Save' }).click();
		await page.waitForLoadState('networkidle');

		// The draft panel reports the route the author chose, not a derived one.
		await expect(page.locator(`text=/${customRoute}`).first()).toBeVisible({
			timeout: 10000,
		});
	});
});
