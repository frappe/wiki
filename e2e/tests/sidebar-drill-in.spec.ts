import { type APIRequestContext, expect, test } from '@playwright/test';
import { createDoc } from '../helpers/frappe';
import { APP_BASE, appUrl } from '../helpers/routes';
import { cleanupWikiSpacesByRoute } from '../helpers/wiki';

/**
 * The IA refactor left the app with exactly one navigation column that drills.
 * At the top level it is the library (every space); entering a space *replaces*
 * that column with the space's own sidebar, and the back button restores it.
 *
 * Two spaces are built below because the load-bearing assertion is a negative
 * one: inside space A, space B's row must be gone. A single-space fixture would
 * pass even if the library list were merely appended to rather than replaced.
 */

const ROUTE_A = `drill-in-a-e2e-${Date.now()}`;
const ROUTE_B = `drill-in-b-e2e-${Date.now()}`;

const SPACE_A_NAME = 'Drill In Alpha';
const SPACE_B_NAME = 'Drill In Beta';
const PAGE_TITLE = 'Alpha First Page';

type Doc = { name: string };

async function space(
	request: APIRequestContext,
	spaceName: string,
	route: string,
) {
	const root = await createDoc<Doc>(request, 'Wiki Document', {
		title: `${spaceName} Root`,
		is_group: 1,
		is_published: 1,
	});
	const created = await createDoc<Doc>(request, 'Wiki Space', {
		space_name: spaceName,
		route,
		root_group: root.name,
		is_published: 1,
	});
	return { spaceId: created.name, rootKey: root.name };
}

test.describe('Sidebar drill-in navigation', () => {
	let spaceA = '';
	let spaceB = '';
	let pageName = '';

	test.beforeAll(async ({ request }) => {
		const a = await space(request, SPACE_A_NAME, ROUTE_A);
		spaceA = a.spaceId;

		const page = await createDoc<Doc>(request, 'Wiki Document', {
			title: PAGE_TITLE,
			is_group: 0,
			is_published: 1,
			parent_wiki_document: a.rootKey,
			sort_order: 0,
			content: 'Drill-in fixture content.',
		});
		pageName = page.name;

		const b = await space(request, SPACE_B_NAME, ROUTE_B);
		spaceB = b.spaceId;
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, ROUTE_A);
		await cleanupWikiSpacesByRoute(request, ROUTE_B);
	});

	test('library lists spaces, entering one replaces the column, back restores it', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });

		// Every assertion is scoped to the nav column. The Overview page in the
		// content column lists the same spaces, so an unscoped href locator
		// matches twice and proves nothing about which column holds the row.
		const sidebar = page.locator('[data-slot="sidebar"]');

		// Level 0: the library. Both spaces are rows; nothing is drilled into.
		await page.goto(APP_BASE);
		const alphaRow = sidebar.locator(`a[href="${appUrl('spaces', spaceA)}"]`);
		const betaRow = sidebar.locator(`a[href="${appUrl('spaces', spaceB)}"]`);
		await expect(alphaRow).toBeVisible();
		await expect(betaRow).toBeVisible();
		await expect(sidebar.locator('[title="Back to Overview"]')).toHaveCount(0);

		// Level 1: the sidebar *becomes* space A.
		await alphaRow.click();
		await expect(page).toHaveURL(new RegExp(`${APP_BASE}/spaces/${spaceA}`));
		await expect(sidebar.locator('[title="Back to Overview"]')).toBeVisible();
		await expect(
			sidebar.getByText(SPACE_A_NAME, { exact: true }).first(),
		).toBeVisible();
		// The replacement, not an addition: the sibling space is no longer
		// reachable from this column.
		await expect(betaRow).toHaveCount(0);

		// Level 2: the tree in that column opens a page in the content column.
		await sidebar.getByText(PAGE_TITLE, { exact: true }).first().click();
		await expect(page).toHaveURL(
			new RegExp(`${APP_BASE}/spaces/${spaceA}/page/${pageName}`),
		);
		// Drilling to a page keeps the space column — it does not drill again.
		await expect(sidebar.locator('[title="Back to Overview"]')).toBeVisible();

		// Back out: the library returns whole, with both spaces.
		await sidebar.locator('[title="Back to Overview"]').first().click();
		await expect(page).toHaveURL(new RegExp(`${APP_BASE}/?$`));
		await expect(alphaRow).toBeVisible();
		await expect(betaRow).toBeVisible();
		await expect(sidebar.locator('[title="Back to Overview"]')).toHaveCount(0);
	});

	test('the retired /spaces list page redirects to the library', async ({
		page,
	}) => {
		// Old deep links have to keep working: the list page retired in phase 1
		// and its path now redirects rather than 404ing.
		await page.goto(appUrl('spaces'));
		await expect(page).toHaveURL(new RegExp(`${APP_BASE}/?$`));
		const sidebar = page.locator('[data-slot="sidebar"]');
		await expect(
			sidebar.locator(`a[href="${appUrl('spaces', spaceA)}"]`),
		).toBeVisible();
	});
});
