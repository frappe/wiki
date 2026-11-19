import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';

const UPLOAD_URL = '**/api/method/wiki.api.upload_wiki_asset';
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
);
const IMAGE = { name: 'photo.png', mimeType: 'image/png', buffer: PNG };
const VIDEO = { name: 'clip.mp4', mimeType: 'video/mp4', buffer: PNG };
const BROKEN_PDF = {
	name: 'broken.pdf',
	mimeType: 'application/pdf',
	buffer: Buffer.from('%PDF-1.4 broken'),
};

const IMAGE_ERROR = '.wiki-image-error';
const VIDEO_ERROR = '.video-placeholder .placeholder-content span';
const PDF_ERROR = '.wiki-pdf-error-body';

const REASON = 'File type of PNG is not allowed';
const REASON_MESSAGE = `Upload failed: ${REASON}`;
const NO_REASON_MESSAGE =
	'Upload failed: The file could not be saved. Try again.';

type UploadFile = typeof IMAGE;

function failWithReason(route: Route) {
	return route.fulfill({
		status: 417,
		contentType: 'application/json',
		body: JSON.stringify({
			exc_type: 'ValidationError',
			_server_messages: JSON.stringify([
				JSON.stringify({ message: 'File type of <b>PNG</b> is not allowed' }),
			]),
		}),
	});
}

function failWithoutReason(route: Route) {
	return route.fulfill({
		status: 500,
		contentType: 'application/json',
		body: JSON.stringify({
			exc_type: 'KeyError',
			exception: 'KeyError: internal_detail',
		}),
	});
}

async function openEditor(page: Page, wiki: WikiFactory) {
	const space = await wiki.space({ pages: [{ title: 'Uploads' }] });
	await wiki.changeRequest(space);
	await page.goto(space.url('page', space.page('Uploads').name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.press('Enter');
}

async function pickFromSlashMenu(
	page: Page,
	command: string,
	title: string,
	file: UploadFile,
) {
	const chooser = page.waitForEvent('filechooser');
	await page.keyboard.type(`/${command}`);
	const menu = page.locator('.slash-commands-list');
	await expect(menu.getByText(title, { exact: true })).toBeVisible();
	await page.keyboard.press('Enter');
	await (await chooser).setFiles(file);
}

function transferOf(file: UploadFile) {
	return {
		name: file.name,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
	};
}

async function pasteFile(page: Page, file: UploadFile) {
	await page.evaluate(({ name, mimeType, base64 }) => {
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const clipboardData = new DataTransfer();
		clipboardData.items.add(new File([bytes], name, { type: mimeType }));
		document.querySelector('.ProseMirror')?.dispatchEvent(
			new ClipboardEvent('paste', {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, transferOf(file));
}

async function pasteDataImage(page: Page) {
	await page.evaluate(
		(markdown) => {
			const clipboardData = new DataTransfer();
			clipboardData.setData('text/plain', markdown);
			document.querySelector('.ProseMirror')?.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData,
					bubbles: true,
					cancelable: true,
				}),
			);
		},
		`![pasted](data:image/png;base64,${PNG.toString('base64')})`,
	);
}

async function dropFile(page: Page, file: UploadFile) {
	await page.evaluate(({ name, mimeType, base64 }) => {
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const dataTransfer = new DataTransfer();
		dataTransfer.items.add(new File([bytes], name, { type: mimeType }));
		const dom = document.querySelector('.ProseMirror') as HTMLElement;
		const box = dom.getBoundingClientRect();
		dom.dispatchEvent(
			new DragEvent('drop', {
				dataTransfer,
				bubbles: true,
				cancelable: true,
				clientX: box.left + 10,
				clientY: box.top + 10,
			}),
		);
	}, transferOf(file));
}

async function expectMessage(page: Page, selector: string, message: string) {
	await expect(page.locator(selector)).toHaveText(message, { timeout: 20000 });
	await expect(
		page.locator('[data-sonner-toast]').filter({ hasText: message }),
	).toBeVisible();
}

test.describe('Failed upload message', () => {
	test('a broken PDF explains what is wrong with the file', async ({
		page,
		wiki,
	}) => {
		await openEditor(page, wiki);
		const response = page.waitForResponse(UPLOAD_URL);
		await pickFromSlashMenu(page, 'pdf', 'PDF', BROKEN_PDF);

		expect((await response).status()).toBe(417);
		await expectMessage(
			page,
			PDF_ERROR,
			'Upload failed: This PDF could not be read. The file may be damaged.',
		);
	});

	const paths: [string, string, (page: Page) => Promise<void>][] = [
		[
			'image picker',
			IMAGE_ERROR,
			(page) => pickFromSlashMenu(page, 'image', 'Image', IMAGE),
		],
		[
			'video picker',
			VIDEO_ERROR,
			(page) => pickFromSlashMenu(page, 'video', 'Video', VIDEO),
		],
		[
			'PDF picker',
			PDF_ERROR,
			(page) => pickFromSlashMenu(page, 'pdf', 'PDF', BROKEN_PDF),
		],
		['pasted image file', IMAGE_ERROR, (page) => pasteFile(page, IMAGE)],
		['pasted data image', IMAGE_ERROR, pasteDataImage],
		['dropped image', IMAGE_ERROR, (page) => dropFile(page, IMAGE)],
		['dropped video', VIDEO_ERROR, (page) => dropFile(page, VIDEO)],
		['dropped PDF', PDF_ERROR, (page) => dropFile(page, BROKEN_PDF)],
	];

	for (const [name, selector, upload] of paths) {
		test(`${name} shows the server's reason`, async ({ page, wiki }) => {
			await page.route(UPLOAD_URL, failWithReason);
			await openEditor(page, wiki);
			await upload(page);
			await expectMessage(page, selector, REASON_MESSAGE);
		});

		test(`${name} does not repeat itself without a reason`, async ({
			page,
			wiki,
		}) => {
			await page.route(UPLOAD_URL, failWithoutReason);
			await openEditor(page, wiki);
			await upload(page);
			await expectMessage(page, selector, NO_REASON_MESSAGE);
		});
	}

	test('a lost connection says to check the connection', async ({
		page,
		wiki,
	}) => {
		await page.route(UPLOAD_URL, (route) =>
			route.abort('internetdisconnected'),
		);
		await openEditor(page, wiki);
		await pickFromSlashMenu(page, 'image', 'Image', IMAGE);
		await expectMessage(
			page,
			IMAGE_ERROR,
			'Upload failed: Check your connection and try again.',
		);
	});

	test('a file the proxy rejects as too large says so', async ({
		page,
		wiki,
	}) => {
		await page.route(UPLOAD_URL, (route) =>
			route.fulfill({
				status: 413,
				contentType: 'text/html',
				body: '<html><body>Request Entity Too Large</body></html>',
			}),
		);
		await openEditor(page, wiki);
		await pickFromSlashMenu(page, 'image', 'Image', IMAGE);
		await expectMessage(
			page,
			IMAGE_ERROR,
			'Upload failed: This file is too large to upload.',
		);
	});
});
