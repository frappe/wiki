import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	type WikiDocument,
	type WikiSpace,
	cleanupWikiSpacesByRoute,
	createTestWikiDocument,
	createTestWikiSpace,
} from '../helpers/wiki';

/**
 * The reader sidebar must always reveal the current page: expand its ancestor
 * groups, highlight it, and scroll it into view — both on a direct page load
 * (shared link / search result) and after client-side navigation via the
 * prev/next buttons (see issue #685).
 */
test.describe('Reader sidebar reveals current page', () => {
	const spaceRoute = `sidebar-reveal-${Date.now()}`;
	let space: WikiSpace;
	let topPage: WikiDocument;
	let deepPage: WikiDocument;
	let lastFiller: WikiDocument;

	const FILLER_COUNT = 30;

	test.beforeAll(async ({ request }) => {
		space = await createTestWikiSpace(request, {
			route: spaceRoute,
			is_published: true,
		});
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceRoute}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		topPage = await createTestWikiDocument(request, {
			title: 'Top Page',
			route: `${spaceRoute}/top`,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		// Group > Sub Group > Deep Page — two collapsed levels above the page
		const group = await createTestWikiDocument(request, {
			title: 'Outer Group',
			route: `${spaceRoute}/outer`,
			is_group: true,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		const subGroup = await createTestWikiDocument(request, {
			title: 'Inner Group',
			route: `${spaceRoute}/outer/inner`,
			is_group: true,
			is_published: true,
			parent_wiki_document: group.name,
		});
		deepPage = await createTestWikiDocument(request, {
			title: 'Deep Page',
			route: `${spaceRoute}/outer/inner/deep`,
			is_published: true,
			parent_wiki_document: subGroup.name,
		});

		// Enough siblings after the deep page to overflow the sidebar viewport
		for (let i = 0; i < FILLER_COUNT; i++) {
			lastFiller = await createTestWikiDocument(request, {
				title: `Filler Page ${String(i).padStart(2, '0')}`,
				route: `${spaceRoute}/filler-${String(i).padStart(2, '0')}`,
				is_published: true,
				parent_wiki_document: rootGroup.name,
			});
		}
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, spaceRoute);
	});

	function sidebarLink(page: import('@playwright/test').Page, route: string) {
		return page.locator(`.wiki-sidebar a[data-route="${route}"]`);
	}

	test('direct load expands ancestor groups and highlights the page', async ({
		page,
	}) => {
		await page.goto(`/${deepPage.route}`);
		await page.waitForLoadState('networkidle');

		const link = sidebarLink(page, deepPage.route);
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('aria-current', 'page');
	});

	test('direct load scrolls a far-down page into view', async ({ page }) => {
		await page.goto(`/${lastFiller.route}`);
		await page.waitForLoadState('networkidle');

		const link = sidebarLink(page, lastFiller.route);
		// scrollIntoView runs 300ms after the expand transition
		await expect(link).toBeInViewport({ timeout: 5000 });
		await expect(link).toHaveAttribute('aria-current', 'page');
	});

	test('client-side prev/next navigation reveals the new page', async ({
		page,
	}) => {
		await page.goto(`/${topPage.route}`);
		await page.waitForLoadState('networkidle');

		// Deep page is hidden inside two collapsed groups
		await expect(sidebarLink(page, deepPage.route)).toBeHidden();

		// The next-page pill (title only now, no "Next Page" label) goes to the
		// deep page, adjacent in the flattened tree — target it by destination.
		await page
			.locator(`#wiki-nav-buttons a[href="/${deepPage.route}"]`)
			.click();
		await page.waitForURL(`**/${deepPage.route}`);

		const link = sidebarLink(page, deepPage.route);
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute('aria-current', 'page');
		await expect(link).toBeInViewport({ timeout: 5000 });
	});
});
