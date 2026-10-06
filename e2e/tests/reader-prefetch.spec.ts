import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';

test.describe('Reader hover prefetch', () => {
	let space: SeededSpace;

	test.beforeAll(async ({ wikiSuite }) => {
		space = await wikiSuite.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
		});
	});

	function recordPrefetches(page: Page) {
		const routes: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('wiki_document.get_page_data')) {
				routes.push(request.postDataJSON().route);
			}
		});
		return routes;
	}

	function sidebarLink(page: Page, title: string) {
		return page.locator(
			`.wiki-sidebar a[data-route="${space.page(title).route}"]`,
		);
	}

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(`/${space.page('Alpha').route}`);
		await expect(sidebarLink(page, 'Gamma')).toBeVisible();
	});

	test('fetches only the link the pointer settles on', async ({ page }) => {
		const prefetches = recordPrefetches(page);

		await sidebarLink(page, 'Beta').hover();
		await sidebarLink(page, 'Gamma').hover();
		await page.waitForTimeout(500);

		expect(prefetches).toEqual([space.page('Gamma').route]);
	});

	test('skips a link the pointer only passes over', async ({ page }) => {
		const prefetches = recordPrefetches(page);

		await sidebarLink(page, 'Beta').hover();
		await page.locator('#wiki-content').hover();
		await page.waitForTimeout(500);

		expect(prefetches).toEqual([]);
	});
});
