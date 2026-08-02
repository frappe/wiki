import {
	type APIRequestContext,
	type Locator,
	expect,
	test,
} from '@playwright/test';
import { createDoc } from '../helpers/frappe';
import { APP_BASE } from '../helpers/routes';
import { cleanupWikiSpacesByRoute } from '../helpers/wiki';

/**
 * Horizontal tab navigation: top-level groups flagged `is_tab` render in a bar
 * above the tree, and clicking one swaps the tree to that tab's subtree.
 *
 * The space is built through the API rather than reusing an existing one, so
 * the tab layout under test is exactly the one asserted against.
 */

const ROUTE = `tabs-e2e-${Date.now()}`;

type Doc = { name: string };

// Layout assertions compare row positions, so a missing box is a real failure
// rather than something to silently skip.
async function box(locator: Locator) {
	const rect = await locator.boundingBox();
	if (!rect) throw new Error('element has no bounding box');
	return rect;
}

async function group(
	request: APIRequestContext,
	title: string,
	parent: string,
	sortOrder: number,
	tabIcon?: string,
) {
	return createDoc<Doc>(request, 'Wiki Document', {
		title,
		is_group: 1,
		is_published: 1,
		parent_wiki_document: parent,
		sort_order: sortOrder,
		...(tabIcon ? { is_tab: 1, tab_icon: tabIcon } : {}),
	});
}

async function page_(
	request: APIRequestContext,
	title: string,
	parent: string,
	sortOrder: number,
) {
	return createDoc<Doc>(request, 'Wiki Document', {
		title,
		is_group: 0,
		is_published: 1,
		parent_wiki_document: parent,
		sort_order: sortOrder,
		content: `Documentation for ${title}.`,
	});
}

test.describe('Horizontal tab navigation', () => {
	test.beforeAll(async ({ request }) => {
		const root = await createDoc<Doc>(request, 'Wiki Document', {
			title: `Tabs Root ${Date.now()}`,
			is_group: 1,
			is_published: 1,
		});
		await createDoc(request, 'Wiki Space', {
			space_name: 'Tabs E2E',
			route: ROUTE,
			root_group: root.name,
			is_published: 1,
		});

		const accounting = await group(
			request,
			'Accounting',
			root.name,
			0,
			'lucide-wallet',
		);
		const receivables = await group(request, 'Receivables', accounting.name, 0);
		await page_(request, 'Sales Invoice', receivables.name, 0);
		await page_(request, 'Credit Note', receivables.name, 1);

		const manufacturing = await group(
			request,
			'Manufacturing',
			root.name,
			1,
			'lucide-factory',
		);
		const production = await group(
			request,
			'Production',
			manufacturing.name,
			0,
		);
		await page_(request, 'Work Order', production.name, 0);

		// Non-tab top-level content must keep working alongside tabs.
		const misc = await group(request, 'Release Notes', root.name, 2);
		await page_(request, 'v15 Changelog', misc.name, 0);
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, ROUTE);
	});

	test('reader shows the bar, swaps subtrees on SPA nav, and keeps non-tab content', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${ROUTE}/accounting/receivables/sales-invoice`);
		await page.waitForLoadState('networkidle');

		const tabBar = page.getByRole('tablist');
		const sidebar = page.locator('.wiki-sidebar');
		await expect(tabBar.getByRole('tab', { name: 'Accounting' })).toBeVisible();
		await expect(
			tabBar.getByRole('tab', { name: 'Manufacturing' }),
		).toBeVisible();

		// Hard load: the tab owning the current page is the active one.
		await expect(
			tabBar.getByRole('tab', { name: 'Accounting' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByText('Receivables', { exact: true }),
		).toBeVisible();
		await expect(sidebar.getByText('Production', { exact: true })).toBeHidden();

		// SPA navigation must move the bar with it, not leave it stale.
		await tabBar.getByRole('tab', { name: 'Manufacturing' }).click();
		await expect(
			tabBar.getByRole('tab', { name: 'Manufacturing' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			tabBar.getByRole('tab', { name: 'Accounting' }),
		).toHaveAttribute('aria-selected', 'false');
		await expect(
			sidebar.getByText('Production', { exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByText('Receivables', { exact: true }),
		).toBeHidden();

		// With multiple tabs, non-tab top-level content lives under Home, so it's
		// hidden while a tab is active (see the Home test below).
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeHidden();
	});

	test('reader Home tab lands on untabbed content and gates it behind itself', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${ROUTE}/accounting/receivables/sales-invoice`);
		await page.waitForLoadState('networkidle');

		const tabBar = page.getByRole('tablist');
		const sidebar = page.locator('.wiki-sidebar');
		const home = tabBar.getByRole('tab', { name: 'Home' });

		// Home leads the bar (≥2 tabs + untabbed content), inactive on a tab page.
		await expect(home).toBeVisible();
		await expect(home).toHaveAttribute('aria-selected', 'false');
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeHidden();

		// Clicking Home surfaces the untabbed subtree and deselects the tabs.
		await home.click();
		await expect(home).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeVisible();
		await expect(
			tabBar.getByRole('tab', { name: 'Accounting' }),
		).toHaveAttribute('aria-selected', 'false');
	});

	test('reader deep link into a tab subtree highlights that tab on hard load', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${ROUTE}/manufacturing/production/work-order`);
		await page.waitForLoadState('networkidle');

		const tabBar = page.getByRole('tablist');
		const sidebar = page.locator('.wiki-sidebar');
		await expect(
			tabBar.getByRole('tab', { name: 'Manufacturing' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByText('Production', { exact: true }),
		).toBeVisible();
	});

	test('editor shows the bar and swaps the sidebar subtree', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const aside = page.locator('aside').first();
		// The bar sits above the sidebar+content row now, so it's page-level, not
		// scoped to <main>.
		const tabBar = page.getByRole('tablist');
		await expect(tabBar.getByRole('tab', { name: 'Accounting' })).toBeVisible({
			timeout: 15000,
		});
		await expect(aside.getByText('Receivables', { exact: true })).toBeVisible();

		await tabBar.getByRole('tab', { name: 'Manufacturing' }).click();
		await expect(aside.getByText('Production', { exact: true })).toBeVisible();
		await expect(aside.getByText('Receivables', { exact: true })).toHaveCount(
			0,
		);
	});

	test('editor creates a tab with an icon and it appears in the bar immediately', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const aside = page.locator('aside').first();
		const tabBar = page.getByRole('tablist');
		await expect(tabBar.getByRole('tab', { name: 'Accounting' })).toBeVisible({
			timeout: 15000,
		});

		await aside.getByTitle('Add').click();
		await page.getByRole('menuitem', { name: 'New Tab' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Create New Tab')).toBeVisible();
		await dialog.getByLabel('Title').fill('Projects');
		// Curated icon list, so a known-present label must be offered.
		await dialog.getByRole('option', { name: 'Launch' }).click();
		await dialog.getByRole('button', { name: 'Save' }).click();

		// Comes from the draft tree, so it shows before the CR is merged.
		await expect(
			tabBar.getByRole('tab', { name: 'Projects', exact: true }),
		).toBeVisible({
			timeout: 15000,
		});
	});

	test('reader stacks navbar, tabs, then the tree, and renders tab icons', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${ROUTE}/accounting/receivables/sales-invoice`);
		await page.waitForLoadState('networkidle');

		// `banner` picks the page-level header; the mobile one and the article's
		// own <header> are both plain <header> elements.
		const navbar = page.getByRole('banner');
		const tabBar = page.getByRole('tablist');
		const sidebar = page.locator('.wiki-sidebar');

		// The hierarchy is the point of this layout: each row starts below the
		// previous one, and both chrome rows span past the sidebar's width.
		const navbarBox = await box(navbar);
		const tabsBox = await box(tabBar);
		const sidebarBox = await box(sidebar);
		expect(tabsBox.y).toBeGreaterThanOrEqual(
			navbarBox.y + navbarBox.height - 1,
		);
		expect(sidebarBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);
		expect(navbarBox.width).toBeGreaterThan(sidebarBox.width);

		// The space name moved out of the sidebar and into the navbar. `.first()`
		// is the switcher's own label — the rest are its (hidden) menu entries.
		await expect(
			navbar.getByText('Tabs E2E', { exact: true }).first(),
		).toBeVisible();

		// Icons are inlined server-side (wiki.utils.lucide_svg) because the
		// reader's Tailwind build has no lucide plugin.
		await expect(
			tabBar.getByRole('tab', { name: 'Accounting' }).locator('svg'),
		).toBeVisible();
	});

	test('editor bar creates a tab from its own add button, above the draft banner', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		// Banner and bar both sit above the sidebar+content row now, so they're
		// page-level, not scoped to <main>.
		const tabBar = page.getByRole('tablist');
		await expect(tabBar.getByRole('tab', { name: 'Accounting' })).toBeVisible({
			timeout: 15000,
		});

		// The change-request banner is about the whole draft, so it outranks the
		// tab being browsed.
		const bannerBox = await box(page.locator('.contribution-banner'));
		const tabsBox = await box(tabBar);
		expect(bannerBox.y).toBeLessThan(tabsBox.y);

		await page.getByTestId('new-tab-button').click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Create New Tab')).toBeVisible();
		// The dialog only asks for a title now — a default icon is applied and
		// changed inline from the bar afterwards.
		await dialog.getByLabel('Title').fill('Support');
		await dialog.getByRole('button', { name: 'Create' }).click();

		await expect(
			tabBar.getByRole('tab', { name: 'Support', exact: true }),
		).toBeVisible({ timeout: 15000 });
	});

	test('editor reorders tabs by dragging them in the bar', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const tabBar = page.getByRole('tablist');
		const accounting = tabBar.getByRole('tab', { name: 'Accounting' });
		const manufacturing = tabBar.getByRole('tab', { name: 'Manufacturing' });
		await expect(accounting).toBeVisible({ timeout: 15000 });

		// Home leads the bar (synthetic, non-draggable), so compare the real tabs
		// that follow it.
		const order = async () =>
			(await tabBar.getByRole('tab').allInnerTexts())
				.map((t) => t.trim())
				.filter((t) => t !== 'Home');
		expect((await order()).slice(0, 2)).toEqual([
			'Accounting',
			'Manufacturing',
		]);

		// SortableJS runs in pointer-fallback mode, so drive real mouse moves in
		// steps rather than Playwright's HTML5-drag `dragTo` (which it ignores).
		// Drop past the target's midpoint to land the dragged tab after it.
		const src = await box(accounting);
		const dst = await box(manufacturing);
		await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
		await page.mouse.down();
		await page.mouse.move(dst.x + dst.width - 4, dst.y + dst.height / 2, {
			steps: 12,
		});
		await page.mouse.move(dst.x + dst.width - 4, dst.y + dst.height / 2);
		await page.mouse.up();

		await expect
			.poll(async () => (await order()).slice(0, 2))
			.toEqual(['Manufacturing', 'Accounting']);
	});
});

/**
 * A single-tab space still gates its untabbed top-level content behind Home —
 * regression for the sidebar leaking untabbed pages into the one tab's subtree
 * (it took a no-Home inline branch when there were fewer than two tabs).
 */
test.describe('Reader sidebar with a single tab', () => {
	const SOLO_ROUTE = `tabs-solo-e2e-${Date.now()}`;

	test.beforeAll(async ({ request }) => {
		const root = await createDoc<Doc>(request, 'Wiki Document', {
			title: `Solo Tab Root ${Date.now()}`,
			is_group: 1,
			is_published: 1,
		});
		await createDoc(request, 'Wiki Space', {
			space_name: 'Solo Tab E2E',
			route: SOLO_ROUTE,
			root_group: root.name,
			is_published: 1,
		});

		const accounting = await group(
			request,
			'Accounting',
			root.name,
			0,
			'lucide-wallet',
		);
		const receivables = await group(request, 'Receivables', accounting.name, 0);
		await page_(request, 'Payment Entry', receivables.name, 0);

		// Untabbed top-level page — must NOT show while the tab is active.
		await page_(request, 'Bold Heading Check', root.name, 1);
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, SOLO_ROUTE);
	});

	test('untabbed content stays behind Home, out of the tab subtree', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${SOLO_ROUTE}/accounting/receivables/payment-entry`);
		await page.waitForLoadState('networkidle');

		const tabBar = page.getByRole('tablist');
		const sidebar = page.locator('.wiki-sidebar');
		const home = tabBar.getByRole('tab', { name: 'Home' });

		// One tab + untabbed content => Home leads, inactive on the tab page, and
		// the untabbed page is hidden rather than leaking into the tab's sidebar.
		await expect(home).toBeVisible();
		await expect(
			sidebar.getByText('Bold Heading Check', { exact: true }),
		).toBeHidden();

		await home.click();
		await expect(
			sidebar.getByText('Bold Heading Check', { exact: true }),
		).toBeVisible();
	});
});
