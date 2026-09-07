import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import { appUrl } from '../helpers/routes';
import {
	type WikiSpace,
	cleanupWikiSpacesByRoute,
	createTestWikiDocument,
	createTestWikiSpace,
} from '../helpers/wiki';

/**
 * An empty space's content column offers "New page". The dialog that creates
 * one lives in the tree, in the sidebar — a sibling column, not an ancestor —
 * so the button hands its request to a module-scoped flag the tree consumes.
 * This exercises that hand-off end to end: press the button in <main>, get the
 * tree's dialog, and land in the editor on the page it made.
 */
test.describe('Empty space — New page from the content column', () => {
	const route = `empty-new-page-${Date.now()}`;
	let space: WikiSpace;

	test.beforeAll(async ({ request }) => {
		space = await createTestWikiSpace(request, { route, is_published: true });
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${route}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, route);
	});

	test('creates the first page and opens it in the editor', async ({
		page,
	}) => {
		await page.goto(appUrl('spaces', space.name));

		// The sidebar reporting an empty tree is the signal that any auto-open
		// would already have happened.
		await expect(page.locator('aside >> text=No pages yet')).toBeVisible({
			timeout: 15000,
		});

		const content = page.locator('main');
		await content
			.getByRole('button', { name: 'New page', exact: true })
			.click();

		const title = `First Page ${Date.now()}`;
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByLabel('Title').fill(title);
		await dialog.getByRole('button', { name: 'Save' }).click();

		// A created page is a change request entry until it merges, so it opens
		// on the draft route rather than /page/.
		await page.waitForURL(/\/draft\//, { timeout: 15000 });
		await expect(
			page.locator('aside').getByText(title, { exact: false }),
		).toBeVisible({ timeout: 15000 });

		// No reload allowance here on purpose. The panel used to strand on
		// "Draft not found" when the create resolved before it mounted — the
		// temp key it was navigated to had already been promoted away. This
		// asserts the editor arrives first time.
		await expect(page.getByPlaceholder('Page title')).toHaveValue(title, {
			timeout: 15000,
		});
	});
});
