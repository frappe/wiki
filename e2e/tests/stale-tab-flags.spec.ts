import type { Locator } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';

/**
 * Horizontal tabs were removed. `Wiki Space.enable_tabs` and the node-level
 * `is_tab` / `tab_icon` flags stay in the schema so old revisions and change
 * requests still apply, but nothing may read them as navigation any more.
 *
 * The space below is built through the API carrying every one of those legacy
 * flags — the exact shape that used to produce a tab bar. Both surfaces have to
 * render it as one plain tree.
 */

const SPACE_NAME = 'Stale Tabs E2E';

// Layout assertions compare row positions, so a missing box is a real failure
// rather than something to silently skip.
async function box(locator: Locator) {
	const rect = await locator.boundingBox();
	if (!rect) throw new Error('element has no bounding box');
	return rect;
}

test.describe('A space carrying legacy tab flags', () => {
	let space: SeededSpace;
	// The page every test enters on, addressed by the route the server derived.
	let salesInvoiceRoute = '';

	test.beforeAll(async ({ wikiSuite }) => {
		space = await wikiSuite.space({
			space_name: SPACE_NAME,
			// The switch that used to raise the tab bar. Nothing reads it now.
			enable_tabs: 1,
			pages: [
				{
					title: 'Accounting',
					is_group: true,
					is_tab: 1,
					tab_icon: 'lucide-wallet',
					children: [
						{
							title: 'Receivables',
							is_group: true,
							children: [{ title: 'Sales Invoice' }, { title: 'Credit Note' }],
						},
					],
				},
				{
					title: 'Manufacturing',
					is_group: true,
					is_tab: 1,
					tab_icon: 'lucide-factory',
					children: [
						{
							title: 'Production',
							is_group: true,
							children: [{ title: 'Work Order' }],
						},
					],
				},
				// Never flagged — used to live behind the synthetic Home tab.
				{
					title: 'Release Notes',
					is_group: true,
					children: [{ title: 'v15 Changelog' }],
				},
			],
		});
		salesInvoiceRoute = space.page('Sales Invoice').route;
	});

	test('reader shows one tree with every top-level group, and no tab bar', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${salesInvoiceRoute}`);
		await page.waitForLoadState('networkidle');

		const sidebar = page.locator('.wiki-sidebar');
		await expect(page.getByRole('tablist')).toHaveCount(0);

		// Flagged and unflagged groups sit side by side; nothing is gated.
		await expect(
			sidebar.getByText('Accounting', { exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByText('Manufacturing', { exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeVisible();

		// The subtree of the open page is expanded, as for any other group.
		await expect(
			sidebar.getByText('Receivables', { exact: true }),
		).toBeVisible();
	});

	test('reader SPA navigation across former tabs keeps the whole tree', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${salesInvoiceRoute}`);
		await page.waitForLoadState('networkidle');

		const sidebar = page.locator('.wiki-sidebar');
		await sidebar.getByText('Manufacturing', { exact: true }).click();
		await expect(
			sidebar.getByText('Production', { exact: true }),
		).toBeVisible();

		await sidebar.getByText('Production', { exact: true }).click();
		await sidebar.getByText('Work Order', { exact: true }).click();
		await expect(page).toHaveURL(
			new RegExp(`/${space.page('Work Order').route}`),
		);

		// The former Home content is still there after the SPA hop.
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeVisible();
	});

	test('reader chrome is the navbar alone, sitting directly above the tree', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${salesInvoiceRoute}`);
		await page.waitForLoadState('networkidle');

		// `banner` picks the page-level header; the mobile one and the article's
		// own <header> are both plain <header> elements.
		const navbar = page.getByRole('banner');
		const sidebar = page.locator('.wiki-sidebar');

		const navbarBox = await box(navbar);
		const sidebarBox = await box(sidebar);

		// The tab row used to sit between these two — the sidebar now starts
		// immediately below the navbar, with no 44px gap left behind.
		expect(sidebarBox.y).toBeGreaterThanOrEqual(
			navbarBox.y + navbarBox.height - 1,
		);
		expect(sidebarBox.y).toBeLessThan(navbarBox.y + navbarBox.height + 4);
		expect(navbarBox.width).toBeGreaterThan(sidebarBox.width);

		await expect(
			navbar.getByText(SPACE_NAME, { exact: true }).first(),
		).toBeVisible();
	});

	test('reader mobile drawer shows one tree with no tab picker', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/${salesInvoiceRoute}`);
		await page.waitForLoadState('networkidle');

		await page.getByTestId('mobile-menu-toggle').click();

		const sheet = page.getByTestId('mobile-bottom-sheet');
		await expect(sheet).toBeVisible();

		// The tab picker was a combobox listing the space's tabs. Gone entirely.
		await expect(sheet.getByRole('listbox')).toHaveCount(0);

		await expect(
			sheet.getByText('Release Notes', { exact: true }),
		).toBeVisible();
		await expect(
			sheet.getByText('Manufacturing', { exact: true }),
		).toBeVisible();
	});

	test('app sidebar renders flagged groups as plain top-level groups', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		const tree = page.locator('aside');
		await expect(tree.getByText('Accounting', { exact: true })).toBeVisible({
			timeout: 15000,
		});

		// All three top-level groups at once — no subtree hidden behind a tab.
		await expect(
			tree.getByText('Manufacturing', { exact: true }),
		).toBeVisible();
		await expect(
			tree.getByText('Release Notes', { exact: true }),
		).toBeVisible();
		await expect(page.getByRole('tablist')).toHaveCount(0);

		// And they expand like any other group.
		await tree.getByText('Accounting', { exact: true }).click();
		await expect(tree.getByText('Receivables', { exact: true })).toBeVisible();
	});
});
