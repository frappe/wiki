import { expect, test } from '../fixtures';

/**
 * An empty space's content column offers "New page". The dialog that creates
 * one lives in the tree, in the sidebar — a sibling column, not an ancestor —
 * so the button hands its request to a module-scoped flag the tree consumes.
 * This exercises that hand-off end to end: press the button in <main>, get the
 * tree's dialog, and land in the editor on the page it made.
 */
test.describe('Empty space — New page from the content column', () => {
	test('creates the first page and opens it in the editor', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space();
		await page.goto(space.url());

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
