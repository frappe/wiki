import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';
import { SPACE_URL_RE, appUrl } from '../helpers/routes';
import { cleanupWikiSpacesByRoute, openNewPageDialog } from '../helpers/wiki';

/**
 * A page deleted in an unmerged change request keeps its row, struck through
 * and flagged, until the change request is merged (#762).
 *
 * The live `Wiki Document` only goes on merge, so hiding the row told the
 * author the page was gone while everyone else still saw it.
 */
test.describe('Pending deletion stays visible', () => {
	let route = '';

	test.afterEach(async ({ request }) => {
		if (route) await cleanupWikiSpacesByRoute(request, route);
		route = '';
	});

	test('deleted page keeps a struck-through row until the merge, and can be restored', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		route = `pending-delete-${timestamp}`;
		const pageTitle = `pending-delete-page-${timestamp}`;

		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(`Pending Delete ${timestamp}`);
		await page.getByLabel('Route').fill(route);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await expect(page).toHaveURL(SPACE_URL_RE);
		const spaceUrl = page.url();

		await openNewPageDialog(page);
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();

		const liveDocs = async () =>
			getList<{ name: string }>(request, 'Wiki Document', {
				fields: ['name'],
				filters: { title: pageTitle },
				limit: 0,
			});

		// Merge, so the page exists as a live Wiki Document that other readers see.
		await mergeChangeRequest(page, spaceUrl);
		expect(await liveDocs()).toHaveLength(1);

		await deleteFromTree(page, spaceUrl, pageTitle);

		// The row stays, flagged, and survives a reload — the deletion is staged,
		// not done, and the live document is still there.
		const row = page.locator('aside').getByText(pageTitle, { exact: true });
		await expect(row).toHaveClass(/line-through/);
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(
			page.locator('aside').getByText(pageTitle, { exact: true }),
		).toHaveClass(/line-through/);
		await expect(page.locator('aside').getByText('Deleted')).toBeVisible();
		expect(await liveDocs()).toHaveLength(1);

		// Restore puts it back as an ordinary row.
		await openRowMenu(page, pageTitle);
		await page.getByRole('menuitem', { name: 'Restore' }).click();
		await expect(
			page.locator('aside').getByText(pageTitle, { exact: true }),
		).not.toHaveClass(/line-through/);

		// Delete again and merge: only then does the live document go.
		await deleteFromTree(page, spaceUrl, pageTitle);
		await mergeChangeRequest(page, spaceUrl);
		expect(await liveDocs()).toHaveLength(0);
		await expect(
			page.locator('aside').getByText(pageTitle, { exact: true }),
		).toHaveCount(0);
	});
});

/** Open the row's three-dots menu in the sidebar tree. */
async function openRowMenu(
	page: import('@playwright/test').Page,
	title: string,
) {
	const row = page.locator('aside div.group', { hasText: title }).last();
	await row.hover();
	await row.getByRole('button').last().click();
}

async function deleteFromTree(
	page: import('@playwright/test').Page,
	spaceUrl: string,
	title: string,
) {
	await page.goto(spaceUrl);
	await page.waitForLoadState('networkidle');
	await openRowMenu(page, title);
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: /Delete/ })
		.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function mergeChangeRequest(
	page: import('@playwright/test').Page,
	spaceUrl: string,
) {
	await page.goto(spaceUrl);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Merge' }).first().click();
	const dialog = page.getByRole('dialog');
	if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
		await dialog.getByRole('button', { name: /Merge/ }).first().click();
	}
	await expect(page.locator('text=Change request merged').first()).toBeVisible({
		timeout: 15000,
	});
}
