import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

const PDF_URL = '/files/lazy-load-check.pdf';
const PDF_BODY = [
	'%PDF-1.1',
	'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
	'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
	'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
	'trailer<</Root 1 0 R>>',
	'%%EOF',
].join('\n');

declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
			};
		};
	}
}

test('editor loads pdf.js only when the page has a PDF', async ({
	page,
	wiki,
}) => {
	await page.route(`**${PDF_URL}`, (route) =>
		route.fulfill({ contentType: 'application/pdf', body: PDF_BODY }),
	);

	await createDraftAndOpenEditor(
		page,
		await wiki.space(),
		`pdf-lazy-load-${Date.now()}`,
	);

	// pdf.js sets this global when its module runs.
	expect(await page.evaluate(() => 'pdfjsLib' in globalThis)).toBe(false);

	await page.evaluate((markdown) => {
		window.wikiEditor.commands.setContent(markdown, {
			contentType: 'markdown',
		});
	}, `![lazy-load-check.pdf](${PDF_URL})`);

	const card = page.locator('.wiki-pdf-wrapper .wiki-pdf-card');
	await expect(card.locator('.wiki-pdf-scroll canvas')).toBeVisible({
		timeout: 15000,
	});
	await expect(card.locator('.wiki-pdf-pages')).toHaveText('1 page');
});
