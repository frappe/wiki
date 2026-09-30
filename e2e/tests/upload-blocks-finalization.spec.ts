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
