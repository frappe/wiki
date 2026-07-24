import { type APIRequestContext, expect, test } from '@playwright/test';
import { createDoc } from '../helpers/frappe';
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

		const sidebar = page.locator('.wiki-sidebar');
		await expect(
			sidebar.getByRole('tab', { name: 'Accounting' }),
		).toBeVisible();
		await expect(
			sidebar.getByRole('tab', { name: 'Manufacturing' }),
		).toBeVisible();

		// Hard load: the tab owning the current page is the active one.
		await expect(
			sidebar.getByRole('tab', { name: 'Accounting' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByText('Receivables', { exact: true }),
		).toBeVisible();
		await expect(sidebar.getByText('Production', { exact: true })).toBeHidden();

		// SPA navigation must move the bar with it, not leave it stale.
		await sidebar.getByRole('tab', { name: 'Manufacturing' }).click();
		await expect(
			sidebar.getByRole('tab', { name: 'Manufacturing' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByRole('tab', { name: 'Accounting' }),
		).toHaveAttribute('aria-selected', 'false');
		await expect(
			sidebar.getByText('Production', { exact: true }),
		).toBeVisible();
		await expect(
			sidebar.getByText('Receivables', { exact: true }),
		).toBeHidden();

		// Decision #7: non-tab top-level groups coexist in the tree.
		await expect(
			sidebar.getByText('Release Notes', { exact: true }),
		).toBeVisible();
	});

	test('reader deep link into a tab subtree highlights that tab on hard load', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/${ROUTE}/manufacturing/production/work-order`);
		await page.waitForLoadState('networkidle');

		const sidebar = page.locator('.wiki-sidebar');
		await expect(
			sidebar.getByRole('tab', { name: 'Manufacturing' }),
		).toHaveAttribute('aria-selected', 'true');
		await expect(
			sidebar.getByText('Production', { exact: true }),
		).toBeVisible();
	});

	test('editor shows the bar and swaps the sidebar subtree', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const aside = page.locator('aside').first();
		await expect(aside.getByRole('tab', { name: 'Accounting' })).toBeVisible({
			timeout: 15000,
		});
		await expect(aside.getByText('Receivables', { exact: true })).toBeVisible();

		await aside.getByRole('tab', { name: 'Manufacturing' }).click();
		await expect(aside.getByText('Production', { exact: true })).toBeVisible();
		await expect(aside.getByText('Receivables', { exact: true })).toHaveCount(
			0,
		);
	});

	test('editor creates a tab with an icon and it appears in the bar immediately', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');
		await page.getByText('Tabs E2E', { exact: true }).first().click();
		await page.waitForLoadState('networkidle');

		const aside = page.locator('aside').first();
		await expect(aside.getByRole('tab', { name: 'Accounting' })).toBeVisible({
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
			aside.getByRole('tab', { name: 'Projects', exact: true }),
		).toBeVisible({
			timeout: 15000,
		});
	});
});
