import { expect, test } from '../fixtures';

/**
 * Covers frappe/wiki#830.
 *
 * The public PDF card ships with an empty preview area that PDF.js fills in
 * later. Until then the reader saw a blank grey strip that jumped open once the
 * pages arrived. The PDF request is held here so the in-between state can be
 * asserted.
 */
const PDF_URL = '/files/loading-state.pdf';

function minimalPdf(): string {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>',
	];
	let body = '%PDF-1.4\n';
	const offsets = objects.map((object, index) => {
		const offset = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets
		.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
		.join('');
	body += `trailer\n<< /Size ${
		objects.length + 1
	} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return body;
}

test.describe('Public PDF embed', () => {
	test('shows a spinner until the first page is rendered', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'PDF Page', content: `![loading-state.pdf](${PDF_URL})` },
			],
		});

		let releasePdf = () => {};
		const pdfHeld = new Promise<void>((resolve) => {
			releasePdf = resolve;
		});
		await page.route(`**${PDF_URL}`, async (route) => {
			await pdfHeld;
			await route.fulfill({
				contentType: 'application/pdf',
				body: minimalPdf(),
			});
		});

		await page.goto(`/${space.page('PDF Page').route}`);

		const card = page.locator('.wiki-pdf-embed');
		const scroll = card.locator('.wiki-pdf-scroll');
		const loader = scroll.locator('[data-role="loader"]');
		await expect(loader.locator('.animate-spin')).toBeVisible();
		expect((await scroll.boundingBox())?.height).toBeGreaterThan(150);

		releasePdf();

		await expect(card).toHaveClass(/is-ready/);
		await expect(loader).toHaveCount(0);
		await expect(scroll.locator('canvas.wiki-pdf-page')).toHaveCount(1);
		await expect(card.locator('[data-role="pages"]')).toHaveText('1 page');
	});
});
