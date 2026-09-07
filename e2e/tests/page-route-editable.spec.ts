import { expect, test } from '../fixtures';
import { openNewPageDialog } from '../helpers/wiki';

/**
 * The new-page dialog prefills the route from the title and lets the author
 * overwrite it. Once overwritten, further title edits must not clobber it.
 */
test.describe('Editable page route', () => {
	test('prefills the route from the title, then lets the author take it over', async ({
		page,
		wiki,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		const space = await wiki.space();
		await page.goto(space.url());
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
		await page.waitForURL(/\/draft\//, { timeout: 15000 });

		// The draft carries the route the author chose, not one derived from the
		// title they typed last. A draft lives only in the local-first store
		// until it is merged, so there is no document to query — the tree's
		// search, which matches a page's route as well as its title, is what
		// can see it.
		const search = page.getByPlaceholder('Search pages...');
		await search.fill(customRoute);
		await expect(
			page.locator('aside').getByText('Route Gamma', { exact: true }),
		).toBeVisible({ timeout: 10000 });
	});
});
