import type { Page, Request } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';
import { getDoc, updateDoc } from '../helpers/frappe';

/**
 * The reader logs a page view on the first load and on every client-side
 * navigation after it, and never for a hover prefetch. make_view_log takes the
 * page path from the Referer header, so that header is what gets asserted.
 */
test.describe('Reader page view tracking', () => {
	let space: SeededSpace;
	let trackingBefore: number;

	test.beforeAll(async ({ wikiSuite, playwright }, workerInfo) => {
		space = await wikiSuite.space({
			pages: [
				{ title: 'Alpha' },
				{ title: 'Beta' },
				{ title: 'Gamma' },
				{ title: 'Delta' },
			],
		});
		const request = await playwright.request.newContext({
			baseURL: workerInfo.project.use.baseURL,
			storageState: 'e2e/.auth/user.json',
		});
		const settings = await getDoc<{ enable_view_tracking: number }>(
			request,
			'Website Settings',
			'Website Settings',
		);
		trackingBefore = settings.enable_view_tracking;
		await updateDoc(request, 'Website Settings', 'Website Settings', {
			enable_view_tracking: 1,
		});
		await request.dispose();
	});

	test.afterAll(async ({ playwright }, workerInfo) => {
		const request = await playwright.request.newContext({
			baseURL: workerInfo.project.use.baseURL,
			storageState: 'e2e/.auth/user.json',
		});
		await updateDoc(request, 'Website Settings', 'Website Settings', {
			enable_view_tracking: trackingBefore,
		});
		await request.dispose();
	});

	function recordViewLogs(page: Page) {
		const logs: { path: string; referrer: string }[] = [];
		page.on('request', async (request: Request) => {
			if (!request.url().includes('web_page_view.make_view_log')) return;
			const headers = await request.allHeaders();
			logs.push({
				path: new URL(headers.referer).pathname,
				referrer: request.postDataJSON().referrer,
			});
		});
		return logs;
	}

	function sidebarLink(page: Page, route: string) {
		return page.locator(`.wiki-sidebar a[data-route="${route}"]`);
	}

	test('logs the first load, each navigation and back, but not a hover', async ({
		page,
		baseURL,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const [alpha, beta, gamma, delta] = ['Alpha', 'Beta', 'Gamma', 'Delta'].map(
			(title) => space.page(title).route,
		);
		const logs = recordViewLogs(page);

		await page.goto(`/${alpha}`);
		await expect.poll(() => logs.length).toBe(1);

		await sidebarLink(page, beta).click();
		await expect(page).toHaveURL(`/${beta}`);
		await expect.poll(() => logs.length).toBe(2);

		await sidebarLink(page, gamma).click();
		await expect(page).toHaveURL(`/${gamma}`);
		await expect.poll(() => logs.length).toBe(3);

		const prefetch = page.waitForResponse((r) =>
			r.url().includes('wiki_document.get_page_data'),
		);
		await sidebarLink(page, delta).hover();
		await prefetch;

		await page.goBack();
		await expect(page).toHaveURL(`/${beta}`);
		await expect.poll(() => logs.length).toBe(4);

		// Nothing late: the hover must not have queued a fifth log.
		await page.waitForTimeout(500);
		expect(logs).toEqual([
			{ path: `/${alpha}`, referrer: '' },
			{ path: `/${beta}`, referrer: `${baseURL}/${alpha}` },
			{ path: `/${gamma}`, referrer: `${baseURL}/${beta}` },
			{ path: `/${beta}`, referrer: `${baseURL}/${gamma}` },
		]);
	});
});
