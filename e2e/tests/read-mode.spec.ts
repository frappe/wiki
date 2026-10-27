import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';
import { updateDoc } from '../helpers/frappe';
import { makeUniquePng } from '../helpers/png';
import { editPage } from '../helpers/wiki';

const IMAGE_URL = '/files/read-mode-e2e.png';
const PDF_URL = '/files/read-mode-e2e.pdf';

const BLOCKS = `Intro paragraph.

## Code

\`\`\`python
print("hello")
\`\`\`

## Media

![A picture](${IMAGE_URL})

![read-mode-e2e.pdf](${PDF_URL})

## Diagram

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

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

async function serveMedia(page: Page) {
	await page.route(`**${IMAGE_URL}`, (route) =>
		route.fulfill({ contentType: 'image/png', body: makeUniquePng(64) }),
	);
	await page.route(`**${PDF_URL}`, (route) =>
		route.fulfill({ contentType: 'application/pdf', body: minimalPdf() }),
	);
}

function recordScripts(page: Page) {
	const scripts: string[] = [];
	page.on('response', (response) => {
		if (response.request().resourceType() === 'script') {
			scripts.push(response.url());
		}
	});
	return scripts;
}

const isEditorChunk = (url: string) =>
	/\/(wiki-starterkit|WikiEditor)-[\w-]+\.js/.test(url);

function reader(page: Page) {
	return page.getByTestId('page-reader');
}

async function openPage(page: Page, space: SeededSpace, title: string) {
	await page.goto(space.url('page', space.page(title).name));
	await expect(reader(page)).toBeVisible({ timeout: 15000 });
}

test.describe('Read mode', () => {
	test('a page view loads no editor until Edit', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha', content: BLOCKS }],
		});
		await serveMedia(page);
		const scripts = recordScripts(page);

		await openPage(page, space, 'Alpha');
		await expect(reader(page).getByText('Intro paragraph.')).toBeVisible();
		await expect(page.locator('.ProseMirror')).toHaveCount(0);
		expect(scripts.filter(isEditorChunk)).toEqual([]);

		await editPage(page, 'Read then edit');
		expect(scripts.some(isEditorChunk)).toBe(true);
		await page.keyboard.type(' Edited.');
		await expect(page.getByText('Draft · 1 page changed')).toBeVisible({
			timeout: 15000,
		});
	});

	test('renders code, images, PDFs and diagrams like the reader', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha', content: BLOCKS }],
		});
		await serveMedia(page);
		await openPage(page, space, 'Alpha');
		const content = reader(page);

		await expect(content.locator('pre.code-block-enhanced')).toHaveCount(1);
		await expect(content.locator('.code-block-lang')).toHaveText('python');
		await expect(content.locator('pre code .hljs-built_in')).toHaveText(
			'print',
		);

		await expect(
			content.locator('pre.mermaid[data-processed] svg'),
		).toBeVisible({
			timeout: 15000,
		});

		await content.getByRole('img', { name: 'A picture' }).click();
		await expect(page.locator('#image-viewer')).toHaveClass(/active/);
		await page.keyboard.press('Escape');
		await expect(page.locator('#image-viewer')).not.toHaveClass(/active/);

		const card = content.locator('.wiki-pdf-embed');
		await card.scrollIntoViewIfNeeded();
		await expect(card.locator('canvas.wiki-pdf-page')).toHaveCount(1, {
			timeout: 15000,
		});
		await card.locator('[data-role="open"]').click();
		await expect(page.locator('.wiki-pdf-viewer.active')).toBeVisible();
		await expect(
			page.locator('.wiki-pdf-viewer canvas.wiki-pdf-viewer-page'),
		).toHaveCount(1, { timeout: 15000 });
	});

	test('outlines the page from the server headings', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha', content: BLOCKS }],
		});
		await serveMedia(page);
		await openPage(page, space, 'Alpha');

		const rail = page.getByTestId('editor-toc-rail');
		await expect(rail.getByTestId('editor-toc-link')).toHaveText([
			'Code',
			'Media',
			'Diagram',
		]);
	});

	test('a link to another page opens it in the app', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
		});
		const beta = space.page('Beta');
		await updateDoc(request, 'Wiki Document', space.page('Alpha').name, {
			content: `Read [about Beta](/${beta.route}).`,
		});

		await openPage(page, space, 'Alpha');
		await reader(page).getByRole('link', { name: 'about Beta' }).click();

		await expect(page).toHaveURL(new RegExp(`/page/${beta.name}$`));
		await expect(reader(page).getByText('Content for Beta')).toBeVisible();
	});
});
