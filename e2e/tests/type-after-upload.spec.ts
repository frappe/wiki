import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
);
// One blank page, written by pypdf.
const PDF = Buffer.from(
	'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNzIgNzIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTEzIDAwMDAwIG4gCjAwMDAwMDAxNjIgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA1Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCj4+CnN0YXJ0eHJlZgoyNTQKJSVFT0YK',
	'base64',
);

type EditorWindow = Window & {
	wikiEditor: {
		getMarkdown(): string;
		commands: { focus(position: string): boolean };
	};
};

async function openEditorAtEnd(page: Page, wiki: WikiFactory) {
	const space = await wiki.space({
		pages: [{ title: 'Uploads', content: 'Start.' }],
	});
	await wiki.changeRequest(space);
	await page.goto(space.url('page', space.page('Uploads').name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as unknown as EditorWindow).wikiEditor !== undefined,
	);
	await page.evaluate(() =>
		(window as unknown as EditorWindow).wikiEditor.commands.focus('end'),
	);
	await page.keyboard.press('Enter');
}

async function pickFromSlashMenu(
	page: Page,
	command: string,
	title: string,
	file: { name: string; mimeType: string; buffer: Buffer },
) {
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.type(`/${command}`);
	const menu = page.locator('.slash-commands-list');
	await expect(menu.getByText(title, { exact: true })).toBeVisible();
	await page.keyboard.press('Enter');
	await (await chooser).setFiles(file);
}

function markdown(page: Page) {
	return page.evaluate(() =>
		(window as unknown as EditorWindow).wikiEditor.getMarkdown(),
	);
}

test.describe('Typing after an upload', () => {
	test('keeps the image and puts the text after it', async ({ page, wiki }) => {
		await openEditorAtEnd(page, wiki);
		await pickFromSlashMenu(page, 'image', 'Image', {
			name: `e2e-upload-${Date.now()}.png`,
			mimeType: 'image/png',
			buffer: PNG,
		});
		await expect(page.locator('img.wiki-image').first()).toHaveAttribute(
			'src',
			/\/files\//,
			{ timeout: 20000 },
		);

		await page.keyboard.type('After the image.');

		await expect(page.locator('img.wiki-image')).toHaveCount(1);
		expect(await markdown(page)).toMatch(
			/!\[.*\]\(\/files\/.*\)\s+After the image\.$/,
		);
	});

	test('keeps the PDF and puts the text after it', async ({ page, wiki }) => {
		await openEditorAtEnd(page, wiki);
		await pickFromSlashMenu(page, 'pdf', 'PDF', {
			name: `e2e-upload-${Date.now()}.pdf`,
			mimeType: 'application/pdf',
			buffer: PDF,
		});
		await expect
			.poll(() => markdown(page), { timeout: 20000 })
			.toMatch(/\/files\/.*\.pdf\)/);

		await page.keyboard.type('After the PDF.');

		expect(await markdown(page)).toMatch(/\.pdf\)\s+After the PDF\.$/);
	});
});
