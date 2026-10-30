import { columnOf, expandTreeGroup, openReaderMenu, spaceIds } from '../lib.mjs';

export async function setup(run) {
	run.state = await spaceIds(run.api);
}

export const shots = [
	{
		name: 'app-sidebar',
		framed: true,
		user: 'grace',
		url: '/wiki-app/spaces',
		crop: (page) => columnOf(page.getByRole('button', { name: 'New Space' })),
	},
	{
		name: 'space-sidebar',
		framed: true,
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.handbook}`,
		async steps(page) {
			await expandTreeGroup(page, 'Time off and benefits');
		},
		crop: (page) => columnOf(page.getByRole('textbox', { name: 'Search pages...' })),
	},
	{
		name: 'reader',
		user: 'kenji',
		url: '/handbook/time-off-and-benefits/paid-time-off',
	},
	{
		name: 'reader-ai-menu',
		user: 'guest',
		url: '/raven/introduction/what-is-raven',
		async crop(page) {
			const menu = await openReaderMenu(page);
			return [page.locator('article h1'), menu];
		},
	},
];
