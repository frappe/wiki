import { type Page, expect, test } from '@playwright/test';
import { SPACE_URL_RE, appUrl } from '../helpers/routes';
import {
	cleanupWikiSpacesByRoute,
	clickSidebarAddOption,
} from '../helpers/wiki';

/**
 * The editor's "On this page" rail mirrors the public reader's TOC, but is
 * driven by the live ProseMirror doc rather than the saved markdown. These
 * specs cover the two things that makes possible: entries that track the
 * document as it is typed, and click-to-scroll inside the editor.
 *
 * The rail collapses to a strip below 900px of editor width, so the narrow
 * case is exercised by resizing the viewport rather than by a phone project —
 * the breakpoint is on the editor element, not the device.
 */

// The breakpoint is on the editor element, which loses ~520px to the app nav
// and the page tree — hence the gap between these two viewports.
const WIDE = { width: 1440, height: 900 };
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

async function createSpaceWithPage(page: Page, stamp: number) {
	const spaceRoute = `editor-toc-${stamp}`;

	await page.setViewportSize(WIDE);
	await page.goto(appUrl('spaces'));
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'New Space' }).click();
	await page.waitForSelector('[role="dialog"]', { state: 'visible' });
	await page.getByLabel('Space Name').fill(spaceRoute);
	await page.getByLabel('Route').fill(spaceRoute);
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Create' })
		.click();
	await expect(page).toHaveURL(SPACE_URL_RE);
	await page.waitForLoadState('networkidle');

	const createFirstPage = page.locator('button:has-text("Create First Page")');
	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await clickSidebarAddOption(page, 'New Page');
	}
	const pageTitle = `TOC Page ${stamp}`;
	await page.getByLabel('Title').fill(pageTitle);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	await openPageFromTree(page, pageTitle);
	return spaceRoute;
}

/**
 * Open a page from the tree and wait for the editor.
 *
 * Creating a page can land on the draft route before the change-request
 * overlay is readable ("Draft not found"), which locally is a queue-lag
 * artefact rather than a product bug — one reload settles it.
 */
async function openPageFromTree(page: Page, pageTitle: string) {
	const treeItem = page.locator('aside').getByText(pageTitle, { exact: false });
	const editor = page.locator('.ProseMirror');

	for (let attempt = 0; attempt < 3; attempt++) {
		if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) return;
		await page.reload();
		await page.waitForLoadState('networkidle');
		await treeItem.first().click();
	}

	await expect(editor).toBeVisible({ timeout: 10000 });
}

test.describe('Editor table of contents', () => {
	const createdRoutes: string[] = [];

	test.afterEach(async ({ request }) => {
		while (createdRoutes.length) {
			const route = createdRoutes.pop() as string;
			await cleanupWikiSpacesByRoute(request, route).catch(() => {});
		}
	});

	test('lists h2/h3 headings and follows the document as it is typed', async ({
		page,
	}) => {
		createdRoutes.push(await createSpaceWithPage(page, Date.now()));
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

	test('clicking an entry scrolls that heading into view', async ({ page }) => {
		createdRoutes.push(await createSpaceWithPage(page, Date.now()));
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

	test('falls back to a collapsible strip when the editor is too narrow', async ({
		page,
	}) => {
		createdRoutes.push(await createSpaceWithPage(page, Date.now()));
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
	}) => {
		createdRoutes.push(await createSpaceWithPage(page, Date.now()));
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
