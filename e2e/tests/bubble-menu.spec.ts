import { expect, test } from '@playwright/test';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

/**
 * Regression: the selection bubble menu must never render on top of the sticky
 * editor toolbar. When the selected text sits on the first line (right under the
 * toolbar) there is no room above it, so the menu has to flip below the selection
 * instead of overlapping the toolbar. See WikiBubbleMenu.vue.
 */
test.describe('Editor bubble menu placement', () => {
	async function createPageAndOpenEditor(
		page: import('@playwright/test').Page,
		pageTitle: string,
	) {
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		await openNewPageDialog(page);

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		return editor;
	}

	test('bubble menu flips below a first-line selection instead of covering the toolbar', async ({
		page,
	}) => {
		await createPageAndOpenEditor(page, `bubble-menu-${Date.now()}`);

		// Put text on the very first line and select it — this sits directly under
		// the sticky toolbar, the exact case that used to overlap.
		const selected = await page.evaluate(() => {
			type ChainStep = {
				focus: () => ChainStep;
				setContent: (html: string) => ChainStep;
				setTextSelection: (range: { from: number; to: number }) => ChainStep;
				run: () => boolean;
			};
			const editor = (
				window as unknown as { wikiEditor?: { chain: () => ChainStep } }
			).wikiEditor;
			if (!editor) return false;
			// Filler paragraphs make the scroll container overflow so the first
			// line can actually be scrolled up under the sticky toolbar — the
			// page title block above the editor otherwise leaves room for the
			// menu to render above the selection.
			const filler = Array.from(
				{ length: 40 },
				(_, i) => `<p>filler ${i}</p>`,
			).join('');
			editor
				.chain()
				.focus()
				.setContent(`<p>first line text</p>${filler}`)
				.run();
			editor.chain().focus().setTextSelection({ from: 1, to: 11 }).run();
			document
				.querySelector('.ProseMirror')
				?.scrollIntoView({ block: 'start' });
			return true;
		});
		expect(selected).toBe(true);

		const bubbleMenu = page.locator('.wiki-bubble-menu');
		await expect(bubbleMenu).toBeVisible({ timeout: 5000 });

		const menuBox = await bubbleMenu.boundingBox();
		const toolbarBox = await page.locator('.wiki-toolbar').boundingBox();
		const selectionBox = await page.evaluate(() => {
			const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
			return r ? { top: r.top, bottom: r.bottom } : null;
		});

		if (!menuBox || !toolbarBox || !selectionBox) {
			throw new Error('Missing layout boxes for bubble menu assertion');
		}

		// The menu must sit entirely below the toolbar (no vertical overlap)...
		expect(menuBox.y).toBeGreaterThanOrEqual(
			toolbarBox.y + toolbarBox.height - 1,
		);
		// ...and below the selection itself, since it flipped down.
		expect(menuBox.y).toBeGreaterThanOrEqual(selectionBox.bottom - 1);
	});
});
