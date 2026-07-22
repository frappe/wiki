import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { type Page, expect, test } from '@playwright/test';
import { deleteDoc, getList, updateDoc } from '../helpers/frappe';

/**
 * E2E coverage for automatic WebP image optimization.
 *
 * Spec: specs/automatic_webp_image_optimization.md
 *
 * When the `auto_convert_images_to_webp` Wiki Setting is on, images uploaded
 * through the editor are converted to WebP server-side (via
 * `wiki.api.upload_wiki_asset`) and embedded with the optimized `.webp` url.
 * When off, the original format is kept.
 */

/**
 * Build a valid RGB PNG entirely in Node, with a unique `tEXt` chunk so the
 * bytes (and thus Frappe's content hash) differ on every call — even across
 * separate test-process runs. Without this, identical bytes would trigger
 * Frappe's content-hash file deduplication and make one upload reuse another's
 * (possibly already-converted) file. Pillow ignores the tEXt chunk on decode,
 * so the server-side WebP conversion still works.
 */
function crc32(buf: Buffer): number {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

function makeUniquePng(size = 8): Buffer {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: RGB
	const pixel = Buffer.from([40, 120, 220]);
	const row = Buffer.concat([Buffer.from([0]), ...Array(size).fill(pixel)]);
	const raw = Buffer.concat(Array(size).fill(row));
	// tEXt chunk: keyword \0 text — carries a unique nonce.
	const nonce = Buffer.from(`Comment\0${randomUUID()}`, 'latin1');
	return Buffer.concat([
		sig,
		pngChunk('IHDR', ihdr),
		pngChunk('tEXt', nonce),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

interface FileDoc {
	name: string;
	file_name: string;
	file_url: string;
}

async function setWebpConversion(
	request: import('@playwright/test').APIRequestContext,
	enabled: boolean,
): Promise<void> {
	await updateDoc(request, 'Wiki Settings', 'Wiki Settings', {
		auto_convert_images_to_webp: enabled ? 1 : 0,
	});
}

/**
 * Navigate to the wiki SPA, open the first space, create a fresh page, and wait
 * until the editor is mounted on its draft. Mirrors the setup used by other
 * editor e2e tests (image-viewer.spec.ts) but stops at the editable draft.
 */
async function openNewPageInEditor(page: Page, title: string): Promise<void> {
	await page.setViewportSize({ width: 1100, height: 900 });
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
	const createDialog = page.getByRole('dialog');
	await createDialog.getByRole('button', { name: 'Save' }).click();
	await expect(createDialog).toBeHidden();
	await expect(page.locator('.dialog-overlay')).toBeHidden();
	await page.waitForLoadState('networkidle');

	const pageTitleInput = page.getByRole('textbox', { name: 'Page title' });
	const openedCreatedPage = await pageTitleInput
		.inputValue({ timeout: 2000 })
		.then((value) => value === title)
		.catch(() => false);
	if (!openedCreatedPage) {
		await page.locator('aside').getByText(title, { exact: true }).click();
	}
	await expect(pageTitleInput).toHaveValue(title, { timeout: 10000 });

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });
	await editor.click();
}

/**
 * Upload an image into the open editor via the hidden slash-command file input,
 * which routes through the same `insertAndUploadImage` path as paste/drop/toolbar.
 */
async function uploadImage(page: Page, fileName: string): Promise<void> {
	await page.locator('input.hidden-file-input').setInputFiles({
		name: fileName,
		mimeType: 'image/png',
		buffer: makeUniquePng(),
	});
}

test.describe('Automatic WebP image optimization', () => {
	// The setting is global; always restore it to the default (on) afterwards.
	test.afterEach(async ({ request }) => {
		await setWebpConversion(request, true);
	});

	// Best-effort: remove the File docs these tests uploaded so they don't
	// accumulate on the site across runs.
	test.afterAll(async ({ request }) => {
		const files = await getList<FileDoc>(request, 'File', {
			fields: ['name'],
			filters: { file_name: ['like', 'e2e-webp-%'] },
			limit: 200,
		}).catch(() => [] as FileDoc[]);
		for (const f of files) {
			await deleteDoc(request, 'File', f.name).catch(() => {});
		}
	});

	test('converts an uploaded PNG to WebP when the setting is enabled', async ({
		page,
		request,
	}) => {
		await setWebpConversion(request, true);

		const stamp = Date.now();
		const fileName = `e2e-webp-on-${stamp}.png`;
		await openNewPageInEditor(page, `webp-on-${stamp}`);
		await uploadImage(page, fileName);

		// The node first shows a base64 preview (loading), then swaps to the
		// converted /files/<name>.webp url once the upload resolves.
		const img = page.locator('img.wiki-image').first();
		await expect(img).toHaveAttribute('src', /\/files\/.*\.webp$/, {
			timeout: 20000,
		});

		const src = await img.getAttribute('src');
		expect(src).toContain(`e2e-webp-on-${stamp}`);
		expect(src).not.toMatch(/data:/); // not still the preview
		expect(src).not.toMatch(/\.png(\?|$)/);

		// Backend: the File doc is webp and no original .png lingers.
		const files = await getList<FileDoc>(request, 'File', {
			fields: ['name', 'file_name', 'file_url'],
			filters: { file_name: ['like', `e2e-webp-on-${stamp}%`] },
			limit: 5,
		});
		expect(files.length).toBeGreaterThan(0);
		for (const f of files) {
			expect(f.file_url).toMatch(/\.webp$/);
			expect(f.file_url).not.toMatch(/\.png$/);
		}
	});

	test('keeps the original format when the setting is disabled', async ({
		page,
		request,
	}) => {
		await setWebpConversion(request, false);

		const stamp = Date.now();
		const fileName = `e2e-webp-off-${stamp}.png`;
		await openNewPageInEditor(page, `webp-off-${stamp}`);
		await uploadImage(page, fileName);

		// With conversion off, the image stays a .png served from /files.
		const img = page.locator('img.wiki-image').first();
		await expect(img).toHaveAttribute('src', /\/files\/.*\.png$/, {
			timeout: 20000,
		});

		const src = await img.getAttribute('src');
		expect(src).toContain(`e2e-webp-off-${stamp}`);
		expect(src).not.toMatch(/\.webp/);
	});
});
