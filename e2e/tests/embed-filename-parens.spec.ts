import { expect, test } from '@playwright/test';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

/**
 * Covers frappe/wiki#757.
 *
 * Frappe keeps the uploaded filename, so a second upload of the same file
 * lands at `/files/name (2).pdf` — spaces and parens both. The tokenizers used
 * to match the URL with `([^)]+)`, which stops at the inner `)`, and the
 * truncated URL then failed the `.pdf` / video extension sniff. Nothing
 * claimed the line, marked's default link rule rejected the unescaped spaces,
 * and the embed showed up as raw markdown text.
 */
const PDF_URL = '/files/VIEW QUICK 2X5L (2).pdf';
const PDF_MARKDOWN = `![VIEW QUICK 2X5L (2).pdf](${PDF_URL})`;

const VIDEO_URL = '/files/my clip (1).mp4';
const VIDEO_MARKDOWN = `![my clip (1).mp4](${VIDEO_URL})`;

declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
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

	await page.locator('aside').getByText(title, { exact: true }).click();

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });

	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	return editor;
}

test.describe('Embed filenames with spaces and parens', () => {
	test('parses a PDF whose filename has spaces and parens into a node', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `pdf-parens-parse-${Date.now()}`);

		const result = await page.evaluate((markdown) => {
			window.wikiEditor.commands.setContent(markdown, {
				contentType: 'markdown',
			});
			const json = window.wikiEditor.getJSON();
			const block = json.content?.find((n) => n.type === 'pdfBlock');
			return {
				hasBlock: !!block,
				src: block?.attrs?.src as string | undefined,
				filename: block?.attrs?.filename as string | undefined,
			};
		}, PDF_MARKDOWN);

		// The whole point: the URL survives past the inner ")".
		expect(result.hasBlock).toBe(true);
		expect(result.src).toBe(PDF_URL);
		expect(result.filename).toBe('VIEW QUICK 2X5L (2).pdf');
	});

	test('renders the PDF card rather than the raw markdown', async ({
		page,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			`pdf-parens-render-${Date.now()}`,
		);

		await page.evaluate((markdown) => {
			window.wikiEditor.commands.setContent(markdown, {
				contentType: 'markdown',
			});
		}, PDF_MARKDOWN);

		const card = page.locator('.wiki-pdf-wrapper .wiki-pdf-card');
		await expect(card).toBeVisible({ timeout: 5000 });
		await expect(card.locator('.wiki-pdf-name')).toHaveText(
			'VIEW QUICK 2X5L (2).pdf',
		);
		// The reported symptom, asserted directly.
		await expect(editor).not.toContainText('![VIEW QUICK');
	});

	test('round-trips the PDF markdown without truncating the URL', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `pdf-parens-roundtrip-${Date.now()}`);

		const { md1, md2 } = await page.evaluate((markdown) => {
			window.wikiEditor.commands.setContent(markdown, {
				contentType: 'markdown',
			});
			const md1 = window.wikiEditor.getMarkdown();
			// Second pass: re-parse what we serialized. A page that degrades to
			// text does it here, on the load after the save.
			window.wikiEditor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = window.wikiEditor.getMarkdown();
			return { md1, md2 };
		}, PDF_MARKDOWN);

		expect(md1).toContain(PDF_MARKDOWN);
		expect(md2).toContain(PDF_MARKDOWN);
	});

	test('parses a video whose filename has spaces and parens into a node', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `video-parens-parse-${Date.now()}`);

		const result = await page.evaluate((markdown) => {
			window.wikiEditor.commands.setContent(markdown, {
				contentType: 'markdown',
			});
			const json = window.wikiEditor.getJSON();
			const block = json.content?.find((n) => n.type === 'videoBlock');
			return {
				hasBlock: !!block,
				src: block?.attrs?.src as string | undefined,
			};
		}, VIDEO_MARKDOWN);

		expect(result.hasBlock).toBe(true);
		expect(result.src).toBe(VIDEO_URL);
	});
});
