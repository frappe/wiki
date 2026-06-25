import { expect, test } from '@playwright/test';

/**
 * Covers the iframe embed extension added for frappe/wiki#599.
 *
 * The fixture below is exactly the iframe YouTube's Share → Embed dialog
 * produces today — full attribute set (width, height, allow, referrerpolicy,
 * allowfullscreen). That's the realistic paste we need to support.
 */
const IFRAME_FIXTURE =
	'<iframe width="560" height="315" ' +
	'src="https://www.youtube.com/embed/QDia3e12czc?si=8or3Lz5IEeelsdcF" ' +
	'title="YouTube video player" frameborder="0" ' +
	'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
	'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';

const IFRAME_SRC =
	'https://www.youtube.com/embed/QDia3e12czc?si=8or3Lz5IEeelsdcF';

declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
				setIframe?: (attrs: Record<string, unknown>) => boolean;
			};
			getMarkdown: () => string;
			getJSON: () => {
				type: string;
				content: { type: string; attrs?: Record<string, unknown> }[];
			};
		};
	}
}

/**
 * Create a draft page and open the editor. Mirrors the helper in
 * image-viewer.spec.ts — duplicated here rather than exported so changes
 * to one test don't ripple into others.
 */
async function createDraftAndOpenEditor(
	page: import('@playwright/test').Page,
	title: string,
) {
	await page.goto('/wiki');
	await page.waitForLoadState('networkidle');

	const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
	await expect(spaceLink).toBeVisible({ timeout: 5000 });
	await spaceLink.click();
	await page.waitForLoadState('networkidle');

	const createFirstPage = page.locator('button:has-text("Create First Page")');
	const newPageButton = page.locator('button[title="New Page"]');

	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await newPageButton.click();
	}

	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	await page.locator('aside').getByText(title, { exact: true }).click();

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });

	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	return editor;
}

test.describe('Iframe embed extension', () => {
	test('parses a YouTube iframe HTML block from markdown into a node', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `iframe-parse-${Date.now()}`);

		const result = await page.evaluate((html) => {
			window.wikiEditor.commands.setContent(html, { contentType: 'markdown' });
			const json = window.wikiEditor.getJSON();
			const block = json.content?.find((n) => n.type === 'iframeBlock');
			return {
				hasBlock: !!block,
				src: block?.attrs?.src as string | undefined,
				allowfullscreen: block?.attrs?.allowfullscreen as boolean | undefined,
				title: block?.attrs?.title as string | undefined,
				width: block?.attrs?.width as string | undefined,
				height: block?.attrs?.height as string | undefined,
			};
		}, IFRAME_FIXTURE);

		expect(result.hasBlock).toBe(true);
		expect(result.src).toBe(IFRAME_SRC);
		expect(result.allowfullscreen).toBe(true);
		expect(result.title).toBe('YouTube video player');
		expect(result.width).toBe('560');
		expect(result.height).toBe('315');
	});

	test('renders the iframe preview inside the editor', async ({ page }) => {
		await createDraftAndOpenEditor(page, `iframe-preview-${Date.now()}`);

		await page.evaluate((html) => {
			window.wikiEditor.commands.setContent(html, { contentType: 'markdown' });
		}, IFRAME_FIXTURE);

		const preview = page.locator(
			'.iframe-block-wrapper iframe[src*="youtube.com/embed"]',
		);
		await expect(preview).toBeVisible({ timeout: 5000 });
		await expect(preview).toHaveAttribute('src', IFRAME_SRC);
	});

	test('round-trips iframe markdown without mutating the src', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `iframe-roundtrip-${Date.now()}`);

		const { md1, md2 } = await page.evaluate((html) => {
			window.wikiEditor.commands.setContent(html, { contentType: 'markdown' });
			const md1 = window.wikiEditor.getMarkdown();
			// Second pass: re-parse the serialized markdown and re-serialize.
			// This is the cycle that used to compound-escape before the extension.
			window.wikiEditor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = window.wikiEditor.getMarkdown();
			return { md1, md2 };
		}, IFRAME_FIXTURE);

		// Both passes preserve the raw src — no &lt;, no &amp;lt; leaking in.
		expect(md1).toContain(`src="${IFRAME_SRC}"`);
		expect(md1).not.toMatch(/&lt;iframe|&amp;lt;/);
		expect(md2).toContain(`src="${IFRAME_SRC}"`);
		expect(md2).not.toMatch(/&lt;iframe|&amp;lt;/);

		// Serialization must be idempotent — a second round-trip shouldn't drift.
		expect(md2).toBe(md1);
	});

	test('accepts the full iframe tag in the /embed URL input', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `iframe-slash-${Date.now()}`);

		// Insert an empty placeholder via the extension command (skips the
		// slash-menu fuzzy-find noise and tests the URL input directly).
		await page.evaluate(() => {
			const editor = window.wikiEditor as unknown as {
				commands: { insertIframePlaceholder: () => boolean };
			};
			editor.commands.insertIframePlaceholder();
		});

		const placeholderInput = page
			.locator('.iframe-block-wrapper')
			.getByPlaceholder('https://');
		await expect(placeholderInput).toBeVisible({ timeout: 5000 });

		await placeholderInput.fill(IFRAME_FIXTURE);
		await page
			.locator('.iframe-block-wrapper')
			.getByRole('button', { name: 'Embed' })
			.click();

		const preview = page.locator(
			'.iframe-block-wrapper iframe[src*="youtube.com/embed"]',
		);
		await expect(preview).toBeVisible({ timeout: 5000 });
		await expect(preview).toHaveAttribute('src', IFRAME_SRC);

		// Saved markdown reflects the attrs pulled from the pasted iframe HTML.
		const md = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(md).toContain(`src="${IFRAME_SRC}"`);
		expect(md).toContain('title="YouTube video player"');
	});
});
