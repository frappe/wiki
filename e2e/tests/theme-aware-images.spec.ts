import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { deleteDoc, getList } from '../helpers/frappe';
import { makeUniquePng } from '../helpers/png';
import { CHANGE_REQUEST_URL_RE } from '../helpers/routes';
import {
	createDraftAndOpenEditor,
	currentDraftDocKey,
	publishChangeRequestFromReview,
	saveEditor,
} from '../helpers/wiki';

/**
 * One image block holds a light and a dark file, and readers see the one that
 * matches the wiki theme.
 *
 * Spec: specs/theme_aware_images.md
 */

const FILE_PREFIX = 'e2e-theme-image';

declare global {
	interface Window {
		wikiEditor: { getMarkdown: () => string };
	}
}

function png(name: string, color: [number, number, number]) {
	return { name, mimeType: 'image/png', buffer: makeUniquePng(8, color) };
}

async function openImageMenu(page: Page) {
	await page.locator('img.wiki-image').first().click();
	await page.getByRole('button', { name: 'Image options' }).click();
}

async function chooseFromImageMenu(
	page: Page,
	item: string,
	file: ReturnType<typeof png>,
) {
	await openImageMenu(page);
	await page.getByRole('menuitem', { name: 'Replace image' }).hover();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: item }).click();
	await (await chooser).setFiles(file);
}

function shownFile(page: Page) {
	return page
		.locator('#wiki-content picture img')
		.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).pathname);
}

test.describe('Theme-aware images', () => {
	test.afterAll(async ({ request }) => {
		const files = await getList<{ name: string }>(request, 'File', {
			fields: ['name'],
			filters: { file_name: ['like', `${FILE_PREFIX}-%`] },
			limit: 50,
		}).catch(() => []);
		for (const file of files) {
			await deleteDoc(request, 'File', file.name).catch(() => {});
		}
	});

	test('an author adds a dark version and readers see it in dark mode', async ({
		page,
		request,
		wiki,
	}) => {
		const stamp = Date.now();
		await page.emulateMedia({ colorScheme: 'light' });
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`theme-image-${stamp}`,
		);
		const docKey = await currentDraftDocKey(page);

		await page
			.locator('input.hidden-file-input')
			.setInputFiles(png(`${FILE_PREFIX}-light-${stamp}.png`, [250, 250, 250]));
		const editorImage = page.locator('img.wiki-image').first();
		await expect(editorImage).toHaveAttribute('src', /\/files\/.*-light-/, {
			timeout: 20000,
		});

		await chooseFromImageMenu(
			page,
			'For dark mode',
			png(`${FILE_PREFIX}-dark-${stamp}.png`, [20, 20, 20]),
		);
		await expect
			.poll(() => page.evaluate(() => window.wikiEditor.getMarkdown()), {
				timeout: 20000,
			})
			.toMatch(/<picture>\n {2}<source srcset="\/files\/[^"]*-dark-/);
		await page.getByPlaceholder('Add a caption').fill('Settings page');

		await expect(editorImage).toHaveAttribute('src', /-light-/);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(editorImage).toHaveAttribute('src', /-dark-/);
		await page.emulateMedia({ colorScheme: 'light' });

		await saveEditor(page);
		await page.waitForLoadState('networkidle');
		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled({ timeout: 10000 });
		await submitButton.click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, { timeout: 10000 });
		await publishChangeRequestFromReview(page);

		const [published] = await getList<{ route: string }>(
			request,
			'Wiki Document',
			{ fields: ['route'], filters: { doc_key: docKey }, limit: 1 },
		);

		// The wiki theme wins over the OS: a reader who picked light on a dark OS
		// still gets the light file.
		const reader = await page.context().newPage();
		await reader.emulateMedia({ colorScheme: 'dark' });
		await reader.goto(`/${published.route}`);
		await reader.evaluate(() => localStorage.setItem('theme', 'light'));
		await reader.reload();
		await expect(reader.locator('#wiki-content picture')).toBeVisible();
		await expect(reader.locator('html')).toHaveAttribute('data-theme', 'light');
		await expect.poll(() => shownFile(reader)).toMatch(/-light-/);
		await expect(reader.locator('#wiki-content picture + em')).toHaveText(
			'Settings page',
		);

		await reader.getByRole('button', { name: 'Toggle theme' }).first().click();
		await expect(reader.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect.poll(() => shownFile(reader)).toMatch(/-dark-/);

		await reader.locator('#wiki-content picture img').click();
		await expect(reader.locator('#image-viewer-img')).toHaveAttribute(
			'src',
			/-dark-/,
		);
		await reader.close();
	});

	test('removing the dark version saves a plain image again', async ({
		page,
		wiki,
	}) => {
		const stamp = Date.now();
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`theme-image-remove-${stamp}`,
		);
		await page
			.locator('input.hidden-file-input')
			.setInputFiles(png(`${FILE_PREFIX}-only-${stamp}.png`, [200, 60, 60]));
		await expect(page.locator('img.wiki-image').first()).toHaveAttribute(
			'src',
			/\/files\//,
			{ timeout: 20000 },
		);
		await chooseFromImageMenu(
			page,
			'For dark mode',
			png(`${FILE_PREFIX}-night-${stamp}.png`, [60, 60, 200]),
		);
		const markdown = () => page.evaluate(() => window.wikiEditor.getMarkdown());
		await expect.poll(markdown, { timeout: 20000 }).toContain('<picture>');

		await openImageMenu(page);
		await page.getByRole('menuitem', { name: 'Replace image' }).hover();
		await page
			.getByRole('menuitem', { name: 'Remove dark mode image' })
			.click();

		await expect.poll(markdown).toMatch(/!\[\]\(\/files\/[^)]*-only-/);
		expect(await markdown()).not.toContain('<picture>');
	});

	test('an author aligns, resizes and captions an image for readers', async ({
		page,
		request,
		wiki,
	}) => {
		const stamp = Date.now();
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`image-options-${stamp}`,
		);
		const docKey = await currentDraftDocKey(page);
		await page.locator('input.hidden-file-input').setInputFiles({
			name: `${FILE_PREFIX}-wide-${stamp}.png`,
			mimeType: 'image/png',
			buffer: makeUniquePng(400, [90, 140, 90]),
		});
		const image = page.locator('img.wiki-image').first();
		await expect(image).toHaveAttribute('src', /\/files\//, { timeout: 20000 });
		const markdown = () => page.evaluate(() => window.wikiEditor.getMarkdown());

		const caption = page.getByPlaceholder('Add a caption');
		await caption.fill('Draft caption');
		await openImageMenu(page);
		await page.getByRole('menu').getByRole('switch').click();
		await expect(caption).toBeHidden();
		await expect.poll(markdown).not.toContain('Draft caption');
		await page.keyboard.press('Escape');

		await openImageMenu(page);
		await page.getByRole('menu').getByRole('switch').click();
		await page.keyboard.press('Escape');
		await caption.fill('Green square');

		await openImageMenu(page);
		await page.getByRole('menuitem', { name: 'Right' }).click();

		await image.click();
		const box = await image.boundingBox();
		const grip = page.getByRole('button', { name: 'Resize image' });
		const gripBox = await grip.boundingBox();
		if (!box || !gripBox) throw new Error('image is not laid out');
		await page.mouse.move(gripBox.x + 10, gripBox.y + 10);
		await page.mouse.down();
		await page.mouse.move(gripBox.x + 10 - 200, gripBox.y + 10, { steps: 5 });
		await page.mouse.up();
		await expect
			.poll(async () => (await image.boundingBox())?.width)
			.toBe(box.width - 200);

		const width = Math.round(box.width - 200);
		await expect
			.poll(markdown)
			.toContain(
				`width="${width}" data-align="right">\n</picture>\n*Green square*`,
			);

		await saveEditor(page);
		await page.waitForLoadState('networkidle');
		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled({ timeout: 10000 });
		await submitButton.click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, { timeout: 10000 });
		await publishChangeRequestFromReview(page);

		const [published] = await getList<{ route: string }>(
			request,
			'Wiki Document',
			{ fields: ['route'], filters: { doc_key: docKey }, limit: 1 },
		);
		const reader = await page.context().newPage();
		await reader.goto(`/${published.route}`);
		const readerImage = reader.locator('#wiki-content picture img');
		await expect(readerImage).toHaveAttribute('width', String(width));
		await expect(reader.locator('#wiki-content picture + em')).toHaveText(
			'Green square',
		);
		const imageBox = await readerImage.boundingBox();
		const contentBox = await reader
			.locator('#wiki-content picture')
			.boundingBox();
		if (!imageBox || !contentBox)
			throw new Error('reader image is not laid out');
		expect(Math.round(imageBox.x + imageBox.width)).toBe(
			Math.round(contentBox.x + contentBox.width),
		);
		await reader.close();
	});
});
