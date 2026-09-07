import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { uniqueRoute } from '../helpers/factory';
import { getDoc } from '../helpers/frappe';
import { appUrl } from '../helpers/routes';

/**
 * Space Settings -> General: the Space Logo tile.
 *
 * The tile is the control -- there is no Upload button beside it any more --
 * and every choice writes straight to the document, so what the browser shows
 * and what the row holds must never disagree. The generated mark is the case
 * worth an e2e: it is produced by a lazily-imported DiceBear chunk, so a
 * broken chunk boundary fails here and nowhere else.
 */
test.describe('Space Settings -> Space Logo', () => {
	async function openPicker(page: Page) {
		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByTestId('space-identity-trigger').click();
		// The popover is portaled out of the dialog, so it lives on the page.
		return page.getByTestId('space-identity-tabs');
	}

	test('picking an icon and a colour stores both and survives a reload', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space();

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		await openPicker(page);
		await page.getByRole('button', { name: 'green', exact: true }).click();
		await page.getByRole('option', { name: 'Knowledge', exact: true }).click();

		await expect
			.poll(async () => {
				const doc = await getDoc(request, 'Wiki Space', space.name);
				return [doc.space_icon, doc.space_color];
			})
			.toEqual(['lucide-book-open-text', 'green']);

		// The mark the sidebar header draws comes from the same fields, so a
		// reload proves the whole round trip and not just the write.
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(
			page.locator('span.lucide-book-open-text').first(),
		).toBeVisible();
	});

	test('shuffle generates a mark, stores its seed, and keeps it on reload', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space();

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		await openPicker(page);
		await page.getByTestId('space-identity-shuffle').click();

		const rolled = await expect
			.poll(
				async () => {
					const doc = await getDoc(request, 'Wiki Space', space.name);
					return doc.avatar_seed || '';
				},
				{ timeout: 15000 },
			)
			.not.toEqual('')
			.then(() => getDoc(request, 'Wiki Space', space.name));

		expect(rolled.avatar_style).toBeTruthy();
		expect(rolled.avatar).toMatch(/^data:image\/svg\+xml[;,]/);

		await page.reload();
		await page.waitForLoadState('networkidle');
		const mark = page.locator(`img[src^="data:image/svg+xml"]`).first();
		await expect(mark).toBeVisible();

		// Rolling again has to change the art, or Shuffle is a no-op button.
		await openPicker(page);
		await page.getByTestId('space-identity-shuffle').click();
		await expect
			.poll(
				async () => {
					const doc = await getDoc(request, 'Wiki Space', space.name);
					return doc.avatar_seed;
				},
				{ timeout: 15000 },
			)
			.not.toEqual(rolled.avatar_seed);
	});

	test('a new space is created with a mark rather than a bare initial', async ({
		page,
		request,
		wiki,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(appUrl());
		await page.waitForLoadState('networkidle');

		const route = uniqueRoute('logo-created');
		await page.getByRole('button', { name: 'New Space' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		// The roll happens as the dialog opens, so the tile is already a mark
		// before anything is typed.
		await expect(
			dialog.locator('img[src^="data:image/svg+xml"]').first(),
		).toBeVisible({ timeout: 15000 });

		await dialog.getByPlaceholder('My Wiki Space').fill(route);
		await dialog.getByRole('button', { name: 'Create', exact: true }).click();
		await page.waitForURL(/\/spaces\//, { timeout: 15000 });

		const spaceName = page.url().split('/spaces/')[1].split(/[/?#]/)[0];
		wiki.adopt(spaceName);

		const doc = await getDoc(request, 'Wiki Space', spaceName);
		expect(doc.avatar).toMatch(/^data:image\/svg\+xml[;,]/);
		expect(doc.avatar_seed).toBeTruthy();
	});
});
