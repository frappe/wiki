import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';
import { getDoc, updateDoc } from '../helpers/frappe';

/**
 * The analytics dashboard in space settings, page settings and the Overview.
 *
 * E2E has no way to fill the rollup table (its job only runs from the
 * scheduler), and the numbers themselves are covered by wiki/api/test_analytics.py.
 * So the tests that check rendering answer get_analytics themselves and assert
 * on what the dashboard asks for. The tracking switch and the wiki-wide scope
 * go to the real server.
 */

const GET_OVERVIEW =
	/\/api\/method\/wiki\.api\.analytics\.get_overview(?:\?|$)/;
const GET_ANALYTICS =
	/\/api\/method\/wiki\.api\.analytics\.get_analytics(?:\?|$)/;

type AnalyticsParams = {
	from_date: string;
	to_date: string;
	interval: string;
	space?: string;
	document?: string;
};

function daysBetween(from: string, to: string) {
	return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function lastOf(requests: AnalyticsParams[]): AnalyticsParams {
	const last = requests.at(-1);
	if (!last) throw new Error('The dashboard has not asked for analytics yet');
	return last;
}

async function stubAnalytics(page: Page, space: SeededSpace) {
	const requests: AnalyticsParams[] = [];
	await page.route(GET_ANALYTICS, async (route) => {
		const params: AnalyticsParams = route.request().postDataJSON();
		requests.push(params);
		const onePage = Boolean(params.document);
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				message: {
					total_views: onePage ? 42 : 1234,
					new_visitors: onePage ? 7 : 321,
					tracking_enabled: true,
					series: [
						{ date: params.from_date, views: 600, new_visitors: 200 },
						{ date: params.to_date, views: 634, new_visitors: 121 },
					],
					top_referrers: [
						{ referrer: 'www.google.com', views: 800 },
						{ referrer: null, views: 434 },
					],
					...(onePage
						? {}
						: {
								top_pages: [
									{
										path: space.page('Alpha').route,
										document: space.page('Alpha').name,
										title: 'Alpha',
										views: 900,
									},
									{
										path: `${space.route}/renamed`,
										document: null,
										title: null,
										views: 334,
									},
								],
						  }),
				},
			}),
		});
	});
	return requests;
}

async function openSpaceAnalytics(page: Page, space: SeededSpace) {
	await page.goto(space.url('page', space.page('Alpha').name));
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Space actions' }).click();
	await page.getByRole('menuitem', { name: 'Space settings' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByText('Analytics', { exact: true }).click();
	return dialog.getByTestId('analytics-dashboard');
}

test.describe('Analytics dashboard', () => {
	let space: SeededSpace;
	let trackingBefore: number;

	test.beforeAll(async ({ wikiSuite, playwright }, workerInfo) => {
		space = await wikiSuite.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
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

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
	});

	test('shows a space, changes range and narrows to one page', async ({
		page,
	}) => {
		const requests = await stubAnalytics(page, space);
		const dashboard = await openSpaceAnalytics(page, space);

		await expect(dashboard.getByTestId('analytics-total-views')).toContainText(
			'1,234',
		);
		await expect(dashboard.getByTestId('analytics-new-visitors')).toContainText(
			'321',
		);
		await expect(dashboard.getByTestId('analytics-tracking-off')).toHaveCount(
			0,
		);

		const topPages = dashboard.getByTestId('analytics-top-pages');
		// A page that no longer exists keeps its path and cannot be filtered to.
		await expect(topPages.getByRole('button', { name: /Alpha/ })).toBeVisible();
		await expect(topPages.getByText(`/${space.route}/renamed`)).toBeVisible();
		await expect(topPages.getByRole('button', { name: /renamed/ })).toHaveCount(
			0,
		);
		const referrers = dashboard.getByTestId('analytics-top-referrers');
		await expect(referrers.getByText('www.google.com')).toBeVisible();
		await expect(referrers.getByText('Direct')).toBeVisible();

		let last = lastOf(requests);
		expect(last).toMatchObject({ space: space.name, interval: 'daily' });
		expect(last.document).toBeUndefined();
		expect(daysBetween(last.from_date, last.to_date)).toBe(29);

		await dashboard.getByTestId('analytics-range').click();
		await page.getByRole('option', { name: 'Last 180 days' }).click();
		await expect.poll(() => lastOf(requests).interval).toBe('weekly');
		last = lastOf(requests);
		expect(daysBetween(last.from_date, last.to_date)).toBe(179);

		// A click anywhere in a week's column, not only on its bar, opens its days.
		const requestsBefore = requests.length;
		const plot = await dashboard.getByTestId('analytics-chart').boundingBox();
		if (!plot) throw new Error('The chart is not on screen');
		await page.mouse.click(
			plot.x + plot.width * 0.2,
			plot.y + plot.height * 0.5,
		);
		await expect.poll(() => requests.length).toBeGreaterThan(requestsBefore);
		last = lastOf(requests);
		expect(last.interval).toBe('daily');
		expect(daysBetween(last.from_date, last.to_date)).toBe(6);
		await expect(dashboard.getByTestId('analytics-range')).toContainText(
			'Custom range',
		);

		await topPages.getByRole('button', { name: /Alpha/ }).click();
		const filter = dashboard.getByTestId('analytics-page-filter');
		await expect(filter).toHaveText('Alpha');
		await expect(dashboard.getByTestId('analytics-total-views')).toContainText(
			'42',
		);
		await expect(topPages).toHaveCount(0);
		last = lastOf(requests);
		// The API takes a page or a space, never both.
		expect(last).toMatchObject({ document: space.page('Alpha').name });
		expect(last.space).toBeUndefined();

		await filter.click();
		await expect(dashboard.getByTestId('analytics-total-views')).toContainText(
			'1,234',
		);
		expect(requests.at(-1)).toMatchObject({ space: space.name });
	});

	test("page settings open the page's analytics", async ({ page }) => {
		const requests = await stubAnalytics(page, space);
		const beta = space.page('Beta');

		await page.goto(space.url('page', beta.name));
		await expect(page.getByPlaceholder('Page title')).toHaveValue('Beta', {
			timeout: 15000,
		});
		await page
			.getByRole('button', { name: 'Page settings', exact: true })
			.click();

		const viewsLink = page.getByTestId('page-views-link');
		await expect(viewsLink).toHaveText('42');
		await viewsLink.click();

		const dashboard = page
			.getByRole('dialog')
			.getByTestId('analytics-dashboard');
		await expect(dashboard.getByTestId('analytics-page-filter')).toHaveText(
			'Beta',
		);
		await expect(dashboard.getByTestId('analytics-total-views')).toContainText(
			'42',
		);
		expect(requests.at(-1)).toMatchObject({
			document: beta.name,
			interval: 'daily',
		});

		// Closing drops the filter, so the next visit shows the whole space.
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();
		await expect(
			page.getByRole('dialog').getByTestId('analytics-page-filter'),
		).toHaveCount(0);
		expect(requests.at(-1)).toMatchObject({ space: space.name });
	});

	test('a manager turns tracking on from the notice', async ({
		page,
		request,
	}) => {
		await updateDoc(request, 'Website Settings', 'Website Settings', {
			enable_view_tracking: 0,
		});
		const dashboard = await openSpaceAnalytics(page, space);

		const notice = dashboard.getByTestId('analytics-tracking-off');
		await expect(notice).toBeVisible();
		await notice.getByRole('button', { name: 'Turn on tracking' }).click();
		await expect(notice).toHaveCount(0);

		const settings = await getDoc<{ enable_view_tracking: number }>(
			request,
			'Website Settings',
			'Website Settings',
		);
		expect(settings.enable_view_tracking).toBe(1);
	});

	test('a manager reads the overview and narrows its chart', async ({
		page,
	}) => {
		const chartRequests = await stubAnalytics(page, space);
		const overviewRequests: AnalyticsParams[] = [];
		await page.route(GET_OVERVIEW, async (route) => {
			overviewRequests.push(route.request().postDataJSON());
			await route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					message: {
						views: { value: 54813, delta: 11.8 },
						new_visitors: { value: 321, delta: null },
						open_change_requests: { value: 7, delta: null },
						open_change_requests_by_space: [
							{ space: space.name, space_name: 'Seeded Space', count: 5 },
							{ space: 'other', space_name: 'Other Space', count: 2 },
						],
						tracking_enabled: true,
						spaces: [
							{
								name: space.name,
								space_name: 'Seeded Space',
								views: 54813,
								delta: -3.8,
							},
						],
						top_pages: [
							{
								path: space.page('Alpha').route,
								document: space.page('Alpha').name,
								title: 'Alpha',
								space: space.name,
								space_name: 'Seeded Space',
								views: 900,
								delta: 0,
							},
						],
					},
				}),
			});
		});

		await page.goto('/wiki-app');
		await expect(page.getByRole('link', { name: 'All Spaces' })).toBeVisible();
		await page.getByRole('link', { name: 'Overview' }).click();
		await expect(page).toHaveURL(/\/wiki-app\/overview$/);
		await expect(page.getByTestId('overview-views')).toContainText('54,813');
		await expect(
			page.getByTestId('overview-open_change_requests'),
		).toContainText('7');
		await expect(page.getByTestId('overview-change-requests')).toContainText(
			'Seeded Space',
		);

		const spaces = page.getByTestId('overview-spaces');
		await expect(spaces).toContainText('Seeded Space');
		await expect(spaces).toContainText('-3.8%');
		const topPages = page.getByTestId('overview-top-pages');
		await expect(topPages).toContainText('Alpha');
		await expect(topPages).toContainText('No change');
		expect(lastOf(chartRequests).space).toBeUndefined();
		const chart = page.getByTestId('overview-chart');
		await expect(chart).toContainText('Views');
		await expect(chart).toContainText('New visitors');

		await page.getByTestId('overview-range').getByText('7 days').click();
		await expect
			.poll(() =>
				daysBetween(
					lastOf(overviewRequests).from_date,
					lastOf(overviewRequests).to_date,
				),
			)
			.toBe(6);

		await page.getByTestId('overview-space').click();
		await page.getByRole('option', { name: 'Seeded Space' }).click();
		await expect.poll(() => lastOf(chartRequests).space).toBe(space.name);

		await topPages.getByText('Alpha').click();
		await expect(page).toHaveURL(
			new RegExp(`/page/${space.page('Alpha').name}`),
		);
	});
});
