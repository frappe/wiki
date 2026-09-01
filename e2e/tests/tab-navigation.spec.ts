import {
	type APIRequestContext,
	type Locator,
	expect,
	test,
} from '@playwright/test';
import { createDoc } from '../helpers/frappe';
import { APP_BASE, appUrl } from '../helpers/routes';
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
	let spaceId = '';

	test.beforeAll(async ({ request }) => {
		const root = await createDoc<Doc>(request, 'Wiki Document', {
			title: `Tabs Root ${Date.now()}`,
			is_group: 1,
			is_published: 1,
		});
		const space = await createDoc<Doc>(request, 'Wiki Space', {
			space_name: 'Tabs E2E',
			route: ROUTE,
			root_group: root.name,
			is_published: 1,
			// Tabs are opt-in per space; every reader test below needs the bar.
			enable_tabs: 1,
		});
		spaceId = space.name;

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

	test('app sidebar renders is_tab groups as plain top-level groups', async ({
		page,
	}) => {
		// The app has no tab bar any more, so `is_tab` is cosmetic-only there: the
		// flagged groups and the untabbed ones sit in one tree together. This space
		// still carries enable_tabs and tab icons, which is exactly the case that
		// must not resurrect a bar.
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(appUrl('spaces', spaceId));
		await page.waitForLoadState('networkidle');

		const tree = page.locator('aside');
		await expect(tree.getByText('Accounting', { exact: true })).toBeVisible({
			timeout: 15000,
		});

		// All three top-level groups at once — no subtree is hidden behind a tab.
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
			enable_tabs: 1,
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

/**
 * Tabs are opt-in per space (Wiki Space.enable_tabs). A space with tab groups
 * but the switch off must show no bar anywhere, and none of its content may
 * become unreachable because a tab was hiding it.
 */
test.describe('Tab navigation disabled', () => {
	const OFF_ROUTE = `tabs-off-e2e-${Date.now()}`;

	test.beforeAll(async ({ request }) => {
		const root = await createDoc<Doc>(request, 'Wiki Document', {
			title: `Tabs Off Root ${Date.now()}`,
			is_group: 1,
			is_published: 1,
		});
		await createDoc(request, 'Wiki Space', {
			space_name: 'Tabs Off E2E',
			route: OFF_ROUTE,
			root_group: root.name,
			is_published: 1,
		});

		// Flagged as a tab, but the space never opts in — so it stays an ordinary
		// top-level group everywhere.
		const accounting = await group(
			request,
			'Accounting',
			root.name,
			0,
			'lucide-wallet',
		);
		await page_(request, 'Sales Invoice', accounting.name, 0);
		await page_(request, 'Release Notes', root.name, 1);
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, OFF_ROUTE);
	});

	test('reader shows no bar and keeps every top-level node in the sidebar', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${OFF_ROUTE}/accounting/sales-invoice`);
		await page.waitForLoadState('networkidle');

		await expect(page.getByRole('tablist')).toHaveCount(0);

		const sidebar = page.locator('.wiki-sidebar');
		await expect(
			sidebar.getByText('Accounting', { exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeVisible();
	});

	test('editor shows no bar, the whole tree, and the page actions row', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs Off E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const aside = page.locator('aside').first();
		await expect(aside.getByText('Accounting', { exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(
			aside.getByText('Release Notes', { exact: true }),
		).toBeVisible();
		await expect(page.getByRole('tablist')).toHaveCount(0);

		// Page actions live in the content column, so they survive the missing bar.
		await aside.getByText('Accounting', { exact: true }).click();
		await aside.getByText('Sales Invoice', { exact: true }).click();
		await expect(page.getByRole('button', { name: 'Save' })).toBeVisible({
			timeout: 15000,
		});
	});
});
