import { expect, test } from '@playwright/test';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

/**
 * Covers the editor's "/" command menu.
 *
 * Regression: tiptap v3's Suggestion dispatches onStart with empty items and
 * delivers the real list in an immediate follow-up onUpdate. The menu used to
 * mount asynchronously and drop that first update, so a bare "/" showed
 * "No commands found" until a character was typed.
 */

/**
 * Create a draft page and open the editor. Mirrors the helper in
 * iframe-embed.spec.ts — duplicated here rather than exported so changes
 * to one test don't ripple into others.
 */
async function createDraftAndOpenEditor(
	page: import('@playwright/test').Page,
	title: string,
) {
	await page.goto(APP_BASE);
	await page.waitForLoadState('networkidle');

	const spaceLink = page.locator(spaceLinkSelector()).first();
	await expect(spaceLink).toBeVisible({ timeout: 5000 });
	await spaceLink.click();
	await page.waitForLoadState('networkidle');

	await openNewPageDialog(page);

	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	// Saving usually auto-opens the new page; fall back to the sidebar entry.
	const titleBox = page.getByPlaceholder('Page title');
	const alreadyOpen = await titleBox
		.inputValue()
		.then((v) => v === title)
		.catch(() => false);
	if (!alreadyOpen) {
		await page.locator('aside').getByText(title, { exact: true }).click();
	}

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });
	return editor;
}

test.describe('Slash command menu', () => {
	test('bare "/" opens the full command list', async ({ page }) => {
		const editor = await createDraftAndOpenEditor(
			page,
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
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
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
