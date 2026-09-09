import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

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

// What the same fixture becomes once it goes through normalizeEmbedUrl: the
// privacy-enhanced host, share query intact. Only paths that normalize (the
// URL input, a paste) produce this — markdown already stored on a page is
// parsed as-is and keeps whichever host it was written with.
const IFRAME_SRC_NORMALIZED =
	'https://www.youtube-nocookie.com/embed/QDia3e12czc?si=8or3Lz5IEeelsdcF';

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

test.describe('Iframe embed extension', () => {
	test('parses a YouTube iframe HTML block from markdown into a node', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-parse-${Date.now()}`,
		);

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

	test('renders the iframe preview inside the editor', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-preview-${Date.now()}`,
		);

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
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-roundtrip-${Date.now()}`,
		);

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

	/**
	 * Fire a real `paste` ClipboardEvent at the ProseMirror node so the editor's
	 * own handlePaste runs — the path a user's Cmd+V takes. A URL copied from
	 * the browser's address bar carries text/plain and nothing else, which is
	 * also the shape that makes handlePaste treat the payload as markdown.
	 */
	async function pasteText(
		page: import('@playwright/test').Page,
		text: string,
	) {
		await page.evaluate((text) => {
			const dom = document.querySelector('.ProseMirror') as HTMLElement | null;
			if (!dom) throw new Error('editor not found');
			dom.focus();
			const dt = new DataTransfer();
			dt.setData('text/plain', text);
			dom.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData: dt,
					bubbles: true,
					cancelable: true,
				}),
			);
		}, text);
	}

	test('turns a pasted YouTube link into an embed', async ({ page, wiki }) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-paste-${Date.now()}`,
		);

		await pasteText(page, 'https://www.youtube.com/watch?v=QDia3e12czc');

		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const block = window.wikiEditor
							.getJSON()
							.content?.find((n) => n.type === 'iframeBlock');
						return (block?.attrs?.src as string) ?? null;
					}),
				{ timeout: 5000 },
			)
			.toBe('https://www.youtube-nocookie.com/embed/QDia3e12czc');
	});

	// A URL sitting inside a sentence is a link, not a video. Only a paste whose
	// entire payload is the URL should embed.
	test('leaves a pasted sentence containing a link as text', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-paste-inline-${Date.now()}`,
		);

		await pasteText(
			page,
			'watch https://www.youtube.com/watch?v=QDia3e12czc later',
		);

		await page.waitForTimeout(500);
		const hasBlock = await page.evaluate(() =>
			Boolean(
				window.wikiEditor
					.getJSON()
					.content?.some((n) => n.type === 'iframeBlock'),
			),
		);
		expect(hasBlock).toBe(false);
	});

	test('accepts the full iframe tag in the /embed URL input', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`iframe-slash-${Date.now()}`,
		);

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
			'.iframe-block-wrapper iframe[src*="youtube-nocookie.com/embed"]',
		);
		await expect(preview).toBeVisible({ timeout: 5000 });
		await expect(preview).toHaveAttribute('src', IFRAME_SRC_NORMALIZED);

		// Saved markdown reflects the attrs pulled from the pasted iframe HTML.
		const md = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(md).toContain(`src="${IFRAME_SRC_NORMALIZED}"`);
		expect(md).toContain('title="YouTube video player"');
	});
});
