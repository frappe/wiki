import { expect, test } from '../fixtures';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
);

/**
 * An image still uploading serializes to nothing, so submitting before it
 * lands would save the page without it. Submit waits for the upload.
 */
test('submit for review waits for an image upload to finish', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Upload Page' }] });
	const target = space.page('Upload Page');

	let releaseUpload = () => {};
	const uploadHeld = new Promise<void>((resolve) => {
		releaseUpload = resolve;
	});
	await page.route(
		'**/api/method/wiki.api.upload_wiki_asset',
		async (route) => {
			await uploadHeld;
			await route.continue();
		},
	);

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(space.url('page', target.name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await page.locator('input.hidden-file-input').setInputFiles({
		name: `e2e-upload-${Date.now()}.png`,
		mimeType: 'image/png',
		buffer: PNG,
	});

	const submit = page.getByRole('button', { name: 'Submit for Review' });
	await expect(submit).toBeVisible({ timeout: 10000 });
	await expect(submit).toBeDisabled();

	releaseUpload();
	await expect(page.locator('img.wiki-image').first()).toHaveAttribute(
		'src',
		/\/files\//,
		{ timeout: 20000 },
	);
	await expect(submit).toBeEnabled();
});

/**
 * A failed upload stays on screen but never reaches saved content, so submit
 * waits until the failed image is removed.
 */
test('submit for review waits until a failed upload is removed', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Failed Upload Page' }] });
	const target = space.page('Failed Upload Page');
	await page.route('**/api/method/wiki.api.upload_wiki_asset', (route) =>
		route.fulfill({ status: 500, body: '{}' }),
	);

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(space.url('page', target.name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await page.locator('input.hidden-file-input').setInputFiles({
		name: `e2e-upload-${Date.now()}.png`,
		mimeType: 'image/png',
		buffer: PNG,
	});
	const failed = page.locator('.wiki-image-error');
	await expect(failed).toBeVisible({ timeout: 10000 });

	const submit = page.getByRole('button', { name: 'Submit for Review' });
	await expect(submit).toBeDisabled();

	await failed.click();
	await page.keyboard.press('Backspace');
	await expect(failed).toHaveCount(0);
	await expect(submit).toBeEnabled();
});

/**
 * Markdown pasted as plain text can carry data-URI images, uploaded through
 * their own path. A failed one must clear once removed, like any other.
 */
test('a failed image pasted as markdown stops blocking once removed', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Pasted Upload Page' }] });
	const target = space.page('Pasted Upload Page');
	await page.route('**/api/method/wiki.api.upload_wiki_asset', (route) =>
		route.fulfill({ status: 500, body: '{}' }),
	);

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(space.url('page', target.name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await page.keyboard.press('Enter');
	await page.evaluate(
		(markdown) => {
			const dom = document.querySelector('.ProseMirror') as HTMLElement;
			const clipboardData = new DataTransfer();
			clipboardData.setData('text/plain', markdown);
			dom.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData,
					bubbles: true,
					cancelable: true,
				}),
			);
		},
		`![pasted](data:image/png;base64,${PNG.toString('base64')})`,
	);
	const failed = page.locator('.wiki-image-error');
	await expect(failed).toBeVisible({ timeout: 10000 });

	const submit = page.getByRole('button', { name: 'Submit for Review' });
	await expect(submit).toBeDisabled();

	await failed.click();
	await page.keyboard.press('Backspace');
	await expect(failed).toHaveCount(0);
	await expect(submit).toBeEnabled();
});

/**
 * An upload that fails after its editor is gone has no node left to remove,
 * so it must not block submit on the page the author moved to.
 */
test('an upload that fails after leaving the page does not block submit', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Left Upload Page' }, { title: 'Next Upload Page' }],
	});
	const left = space.page('Left Upload Page');
	const next = space.page('Next Upload Page');

	let failUpload = () => {};
	const uploadHeld = new Promise<void>((resolve) => {
		failUpload = resolve;
	});
	let uploadArrived = () => {};
	const uploadRequested = new Promise<void>((resolve) => {
		uploadArrived = resolve;
	});
	await page.route(
		'**/api/method/wiki.api.upload_wiki_asset',
		async (route) => {
			uploadArrived();
			await uploadHeld;
			await route.fulfill({ status: 500, body: '{}' });
		},
	);

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(space.url('page', left.name));
	const editor = page.locator('.ProseMirror');
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await page.locator('input.hidden-file-input').setInputFiles({
		name: `e2e-upload-${Date.now()}.png`,
		mimeType: 'image/png',
		buffer: PNG,
	});
	await uploadRequested;

	await page.getByText('Next Upload Page', { exact: true }).click();
	await expect(page).toHaveURL(new RegExp(next.name));
	await expect(editor).toHaveAttribute('contenteditable', 'true', {
		timeout: 15000,
	});

	const submit = page.getByRole('button', { name: 'Submit for Review' });
	await expect(submit).toBeVisible({ timeout: 10000 });
	const uploadFailed = page.waitForResponse('**/wiki.api.upload_wiki_asset');
	failUpload();
	await uploadFailed;
	// Let the rejected upload settle before reading the button state.
	await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
	await expect(submit).toBeEnabled();
});
