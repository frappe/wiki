import { type Page, expect, test } from '@playwright/test';

/**
 * Page version history UI (issue #622).
 *
 * Seeds two published revisions of a page through the self-serve editor merge
 * flow (add v1, then edit to v2), then opens the history browser from the page
 * kebab and asserts the revision list and the content diff render.
 */

/** Set the open editor's content via the exposed wikiEditor and save. */
async function setEditorContentAndSave(page: Page, content: string) {
	const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
	await expect(editor).toBeVisible({ timeout: 10000 });
	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	await page.evaluate((c) => {
		window.wikiEditor.commands.setContent(c, { contentType: 'markdown' });
	}, content);
	await editor.click();
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(500);
}

/** Self-serve publish from the editor (submit -> approve -> merge under the hood). */
async function mergeFromEditor(page: Page) {
	await page.getByRole('button', { name: 'Merge', exact: true }).click();
	await expect(page.locator('text=Change request merged').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForURL(/\/page\//, { timeout: 10000 });
}

test.describe('Page Version History', () => {
	test('kebab → View history lists revisions and shows a content diff', async ({
		page,
	}) => {
		const ts = Date.now();
		const spaceName = `History Space ${ts}`;
		const spaceRoute = `history-space-${ts}`;
		const pageTitle = `history-page-${ts}`;
		// Single-token contents so the word-level diff renders each as one node.
		const v1 = `alphacontent${ts}`;
		const v2 = `bravocontent${ts}`;

		// New space.
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceName);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		// First page as a draft.
		const createFirstPage = page.getByRole('button', {
			name: 'Create First Page',
		});
		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await page.getByRole('button', { name: 'New Page' }).click();
		}
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForTimeout(500);
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);

		// Publish v1 (revision: "added").
		await setEditorContentAndSave(page, v1);
		await mergeFromEditor(page);

		// Edit to v2 and publish again (revision: "edited").
		await setEditorContentAndSave(page, v2);
		await mergeFromEditor(page);

		// Open history from the page kebab. The contribution banner has its own
		// "More actions" kebab, so scope to the document panel header.
		await page
			.locator('[class*="border-b-gray-500/20"]')
			.getByRole('button', { name: 'More actions' })
			.click();
		await page.getByRole('menuitem', { name: 'View history' }).click();
		await expect(page).toHaveURL(/\/page\/[^/]+\/history$/, { timeout: 10000 });

		// The list: newest-first, an "Edited" entry above an "Added" entry.
		await expect(page.getByText('Version history')).toBeVisible();
		await expect(page.getByText('Edited', { exact: true }).first()).toBeVisible(
			{
				timeout: 10000,
			},
		);
		await expect(page.getByText('Added', { exact: true })).toBeVisible();

		// The detail: the newest revision auto-selects and its diff shows the new
		// (v2) content against the previous (v1) version.
		await expect(page.getByText(v2, { exact: false }).first()).toBeVisible({
			timeout: 10000,
		});
	});
});
