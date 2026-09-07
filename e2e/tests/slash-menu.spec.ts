import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

/**
 * Covers the editor's "/" command menu.
 *
 * Regression: tiptap v3's Suggestion dispatches onStart with empty items and
 * delivers the real list in an immediate follow-up onUpdate. The menu used to
 * mount asynchronously and drop that first update, so a bare "/" showed
 * "No commands found" until a character was typed.
 */

test.describe('Slash command menu', () => {
	test('bare "/" opens the full command list', async ({ page, wiki }) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`slash-menu-${Date.now()}`,
		);

		await editor.click();
		await page.keyboard.type('/');

		const menu = page.locator('.slash-commands-list');
		await expect(menu).toBeVisible({ timeout: 5000 });
		await expect(
			page.locator('.slash-commands-empty', { hasText: 'No commands found' }),
		).toHaveCount(0);

		// Full list, not a filtered subset: spot-check items from both ends,
		// plus the group headers (Gameplan-style sections).
		await expect(menu.getByText('Heading 1', { exact: true })).toBeVisible();
		await expect(menu.getByText('Danger', { exact: true })).toBeVisible();
		await expect(menu.getByText('Callouts', { exact: true })).toBeVisible();
	});

	test('typing filters the list and Enter inserts the block', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`slash-filter-${Date.now()}`,
		);

		await editor.click();
		await page.keyboard.type('/quo');

		const menu = page.locator('.slash-commands-list');
		await expect(menu.getByText('Blockquote', { exact: true })).toBeVisible({
			timeout: 5000,
		});
		await expect(menu.getByText('Heading 1', { exact: true })).toHaveCount(0);

		await page.keyboard.press('Enter');
		await expect(editor.locator('blockquote')).toBeVisible({ timeout: 5000 });
	});
});
