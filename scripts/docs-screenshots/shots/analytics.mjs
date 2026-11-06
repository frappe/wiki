import {
	openSpaceSettings,
	openWikiSettings,
	setDeskTheme,
	setViewTracking,
	spaceIds,
	waitCharts,
} from '../lib.mjs';

export async function setup(run) {
	run.state = await spaceIds(run.api);
	run.state.feedback = await run.api.getValue('Wiki Feedback', {
		feedback: ['is', 'set'],
		type: 'Bad',
	});
}

async function deskSteps(page, { theme }) {
	await page.locator('.page-container:visible').first().waitFor();
	await setDeskTheme(page, theme);
	await page.mouse.move(0, 899);
}

export const shots = [
	{
		name: 'overview',
		user: 'grace',
		url: '/wiki-app/overview',
		async steps(page) {
			await page
				.getByRole('radio', { name: '30 days' })
				.or(page.getByRole('button', { name: '30 days' }))
				.first()
				.click();
			await waitCharts(page);
		},
	},
	{
		name: 'space-analytics',
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.raven}`,
		async crop(page) {
			const settings = await openSpaceSettings(page, 'Analytics');
			await waitCharts(page);
			return settings;
		},
	},
	{
		name: 'feedback-list',
		user: 'admin',
		url: '/app/wiki-feedback',
		steps: deskSteps,
	},
	{
		name: 'feedback-record',
		user: 'admin',
		url: ({ state }) => `/app/wiki-feedback/${state.feedback}`,
		steps: deskSteps,
		crop: (page) => [
			page.locator('.page-head:visible').first(),
			page.locator('.layout-main-section:visible').first(),
		],
		padding: 0,
	},
	{
		name: 'view-tracking-toggle',
		user: 'grace',
		url: '/wiki-app/spaces',
		crop: (page) => openWikiSettings(page, 'General'),
	},
	{
		name: 'tracking-off-notice',
		user: 'grace',
		url: '/wiki-app/overview',
		setup: ({ api }) => setViewTracking(api, false),
		teardown: ({ api }) => setViewTracking(api, true),
		async crop(page) {
			const notice = page
				.locator('div')
				.filter({ hasText: 'Page views are not being recorded' })
				.filter({ has: page.getByRole('button', { name: 'Turn on tracking' }) })
				.last();
			await notice.waitFor();
			return [
				page.getByRole('heading', { name: 'Overview' }),
				page.getByRole('radio', { name: '90 days' }),
				notice,
			];
		},
	},
];
