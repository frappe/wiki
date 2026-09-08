import { expect, test } from '../fixtures';
import type { SeededPage } from '../helpers/factory';

/**
 * The reader sidebar must always reveal the current page: expand its ancestor
 * groups, highlight it, and scroll it into view — both on a direct page load
 * (shared link / search result) and after client-side navigation via the
 * prev/next buttons (see issue #685).
 */
test.describe('Reader sidebar reveals current page', () => {
	let topPage: SeededPage;
	let deepPage: SeededPage;
	let lastFiller: SeededPage;

	const FILLER_COUNT = 30;

	test.beforeAll(async ({ wikiSuite }) => {
		const fillerTitles = Array.from(
			{ length: FILLER_COUNT },
			(_, i) => `Filler Page ${String(i).padStart(2, '0')}`,
		);
		const space = await wikiSuite.space({
			pages: [
				{ title: 'Top Page' },
				// Two collapsed levels above the page the sidebar has to reveal.
				{
					title: 'Outer Group',
					is_group: true,
					children: [
						{
							title: 'Inner Group',
							is_group: true,
							children: [{ title: 'Deep Page' }],
						},
					],
				},
				// Enough siblings after the deep page to overflow the viewport.
				...fillerTitles.map((title) => ({ title })),
			],
		});
		topPage = space.page('Top Page');
		deepPage = space.page('Deep Page');
		lastFiller = space.page(fillerTitles[fillerTitles.length - 1]);
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
