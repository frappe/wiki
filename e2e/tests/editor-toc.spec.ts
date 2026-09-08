import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';
import { createDraftAndOpenEditor } from '../helpers/wiki';

/**
 * The editor's "On this page" rail mirrors the public reader's TOC, but is
 * driven by the live ProseMirror doc rather than the saved markdown. These
 * specs cover the two things that makes possible: entries that track the
 * document as it is typed, and click-to-scroll inside the editor.
 *
 * The rail collapses to a strip below 1008px of editor width — the 768px prose
 * column plus the gutter the rail is given — so the narrow case is exercised by
 * resizing the viewport rather than by a phone project: the breakpoint is on
 * the editor element, not the device.
 */

// The breakpoint is on the editor element, which loses ~260px to the space
// sidebar — hence the gap between these viewports. LAPTOP is the tightest
// window that still earns the rail (1280 - 261 = 1019 >= 1008).
const WIDE = { width: 1440, height: 900 };
const LAPTOP = { width: 1280, height: 800 };
const NARROW = { width: 1000, height: 900 };
const PHONE = { width: 375, height: 667 };

const SEED_HTML = [
	'<h2>Installation</h2>',
	...Array.from({ length: 25 }, (_, i) => `<p>install step ${i}</p>`),
	'<h3>Requirements</h3>',
	...Array.from({ length: 25 }, (_, i) => `<p>requirement ${i}</p>`),
	'<h2>Usage</h2>',
	...Array.from({ length: 25 }, (_, i) => `<p>usage note ${i}</p>`),
].join('');

async function seedEditor(page: Page, html: string) {
	const applied = await page.evaluate((content) => {
		const editor = (
			window as unknown as {
				wikiEditor?: {
					commands: { setContent: (value: string) => boolean };
				};
			}
		).wikiEditor;
		if (!editor) return false;
		editor.commands.setContent(content);
		return true;
	}, html);
	expect(applied).toBe(true);
}

/** A space of its own, with one page open in the editor. */
async function createSpaceWithPage(page: Page, wiki: WikiFactory) {
	await page.setViewportSize(WIDE);
	await createDraftAndOpenEditor(
		page,
		await wiki.space(),
		`TOC Page ${Date.now()}`,
	);
}

test.describe('Editor table of contents', () => {
	test('lists h2/h3 headings and follows the document as it is typed', async ({
		page,
		wiki,
	}) => {
		await createSpaceWithPage(page, wiki);
		await seedEditor(page, SEED_HTML);

		const rail = page.locator('[data-testid="editor-toc-rail"]');
		await expect(rail).toBeVisible();
		await expect(rail.getByText('On this page')).toBeVisible();

		const links = rail.locator('[data-testid="editor-toc-link"]');
		await expect(links).toHaveText(['Installation', 'Requirements', 'Usage']);

		// The point of an in-editor TOC: a heading typed now shows up now, with
		// no save and no round trip to the markdown renderer.
		await page.evaluate(() => {
			(
				window as unknown as {
					wikiEditor?: { commands: { focus: (pos: 'end') => boolean } };
				}
			).wikiEditor?.commands.focus('end');
		});
		await page.keyboard.press('Enter');
		await page.keyboard.type('## Troubleshooting');

		await expect(links).toHaveText([
			'Installation',
			'Requirements',
			'Usage',
			'Troubleshooting',
		]);
	});

	test('clicking an entry scrolls that heading into view', async ({
		page,
		wiki,
	}) => {
		await createSpaceWithPage(page, wiki);
		await seedEditor(page, SEED_HTML);

		const rail = page.locator('[data-testid="editor-toc-rail"]');
		const usage = rail.locator('[data-testid="editor-toc-link"]', {
			hasText: 'Usage',
		});

		const heading = page.locator('.ProseMirror h2', { hasText: 'Usage' });
		// Far enough down the document that it starts off screen.
		await expect(heading).not.toBeInViewport();

		await usage.click();
		await expect(heading).toBeInViewport({ timeout: 5000 });

		// It must clear the sticky toolbar rather than hide behind it.
		const headingBox = await heading.boundingBox();
		const toolbarBox = await page.locator('.wiki-toolbar').boundingBox();
		if (!headingBox || !toolbarBox) {
			throw new Error('Missing layout boxes for scroll assertion');
		}
		expect(headingBox.y).toBeGreaterThanOrEqual(
			toolbarBox.y + toolbarBox.height - 1,
		);

		// The entry you jumped to becomes the active one.
		await expect(usage).toHaveClass(/text-ink-gray-9/);
	});

	test('keeps the rail on a 1280px laptop', async ({ page, wiki }) => {
		await createSpaceWithPage(page, wiki);
		await seedEditor(page, SEED_HTML);

		await page.setViewportSize(LAPTOP);

		const rail = page.locator('[data-testid="editor-toc-rail"]');
		await expect(rail).toBeVisible();
		await expect(page.locator('[data-testid="editor-toc-strip"]')).toHaveCount(
			0,
		);

		// The rail is given its own gutter, so it must not sit over the prose.
		const railBox = await rail.boundingBox();
		const proseBox = await page.locator('.ProseMirror').boundingBox();
		expect(railBox).not.toBeNull();
		expect(proseBox).not.toBeNull();
		expect(proseBox.x + proseBox.width).toBeLessThanOrEqual(railBox.x);
	});

	test('falls back to a collapsible strip when the editor is too narrow', async ({
		page,
		wiki,
	}) => {
		await createSpaceWithPage(page, wiki);
		await seedEditor(page, SEED_HTML);

		await expect(page.locator('[data-testid="editor-toc-rail"]')).toBeVisible();

		await page.setViewportSize(NARROW);
		await expect(page.locator('[data-testid="editor-toc-rail"]')).toHaveCount(
			0,
		);

		const strip = page.locator('[data-testid="editor-toc-strip"]');
		await expect(strip).toBeVisible();

		const links = strip.locator('[data-testid="editor-toc-link"]');
		await expect(links).toHaveCount(0);

		await strip.locator('[data-testid="editor-toc-toggle"]').click();
		await expect(links).toHaveText(['Installation', 'Requirements', 'Usage']);

		// Choosing a heading scrolls to it and closes the strip again.
		await links.filter({ hasText: 'Usage' }).click();
		await expect(links).toHaveCount(0);
		await expect(
			page.locator('.ProseMirror h2', { hasText: 'Usage' }),
		).toBeInViewport({ timeout: 5000 });
	});

	test('the strip works on a phone without widening the page', async ({
		page,
		wiki,
	}) => {
		await createSpaceWithPage(page, wiki);
		await seedEditor(page, SEED_HTML);

		await page.setViewportSize(PHONE);

		const strip = page.locator('[data-testid="editor-toc-strip"]');
		await expect(strip).toBeVisible();
		await strip.locator('[data-testid="editor-toc-toggle"]').click();

		const links = strip.locator('[data-testid="editor-toc-link"]');
		await expect(links).toHaveText(['Installation', 'Requirements', 'Usage']);

		// Long heading text must truncate inside the strip rather than push the
		// page into a horizontal scroll.
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});
});
