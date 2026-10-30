import { dialog, openReaderMenu, openReaderSearch, openSpaceSettings, scrollToTop, spaceIds, waitStable } from '../lib.mjs';

const channelPage = '/raven/channels/create-a-channel';
const ravenIntro = '/raven/introduction/what-is-raven';

export async function setup(run) {
	run.state = await spaceIds(run.api);
}

export const shots = [
	{
		name: 'reader-page',
		user: 'guest',
		url: channelPage,
	},
	{
		name: 'page-actions',
		user: 'guest',
		url: channelPage,
		async crop(page) {
			const menu = await openReaderMenu(page);
			return [page.locator('#wiki-page-title'), menu];
		},
	},
	{
		name: 'mobile-menu',
		framed: true,
		user: 'guest',
		url: channelPage,
		viewport: { width: 390, height: 844 },
		scale: 4,
		async crop(page) {
			await page.getByTestId('mobile-menu-toggle').click();
			const sheet = page.getByTestId('mobile-bottom-sheet');
			await sheet.waitFor();
			await waitStable(page);
			const box = await sheet.boundingBox();
			return { x: 0, y: Math.max(0, box.y - 24), width: 390, height: 380 };
		},
	},
	{
		name: 'reader-search',
		user: 'guest',
		url: ravenIntro,
		crop: (page) => openReaderSearch(page, 'webhook'),
	},
	{
		name: 'app-search',
		user: 'grace',
		url: '/wiki-app/spaces',
		async crop(page) {
			await page.getByRole('button', { name: 'Search' }).click();
			const palette = dialog(page);
			await palette.getByRole('combobox').or(palette.getByRole('textbox')).first().fill('raven');
			await palette.getByText('Spaces', { exact: true }).waitFor();
			await palette.getByText('Pages', { exact: true }).waitFor();
			return palette;
		},
	},
	{
		name: 'theme-toggle',
		user: 'guest',
		url: ravenIntro,
		crop: (page) => [
			page.getByRole('button', { name: 'Open search' }),
			page.getByRole('button', { name: 'Toggle theme' }),
		],
		padding: 12,
	},
	{
		name: 'theme-image',
		user: 'guest',
		url: ravenIntro,
		async crop(page) {
			const intro = page.locator('article p').first();
			await scrollToTop(intro);
			return [intro, page.locator('article img').first()];
		},
	},
	{
		name: 'download-pdf',
		framed: true,
		user: 'guest',
		url: channelPage,
		async crop(page) {
			const menu = await openReaderMenu(page);
			return [page.getByRole('button', { name: 'More page actions' }), menu];
		},
	},
	{
		name: 'allow-pdf-setting',
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.raven}`,
		async crop(page) {
			const settings = await openSpaceSettings(page, 'Access');
			return [settings.getByText('Accept Contributions', { exact: true }), settings.getByRole('switch', { name: 'Allow PDF Download' }), settings.getByText('Let readers download wiki pages as PDF')];
		},
	},
	{
		name: 'feedback-widget',
		user: 'guest',
		url: channelPage,
		async crop(page) {
			const row = page.locator('#wiki-last-updated').locator('..');
			await row.scrollIntoViewIfNeeded();
			await page.getByRole('radio', { name: 'Good' }).or(page.getByRole('button', { name: 'Good' })).first().click();
			await row.locator('textarea').fill('Clear steps, thanks.');
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await page.waitForTimeout(300);
			return row;
		},
	},
];
