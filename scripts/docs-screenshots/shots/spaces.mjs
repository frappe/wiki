import { SPACES, dialog, openMarkPicker, openSpaceSettings, spaceIds } from '../lib.mjs';

export async function setup(run) {
	run.state = await spaceIds(run.api);
}

export const shots = [
	{
		name: 'new-space-dialog',
		user: 'grace',
		url: '/wiki-app/spaces',
		async steps(page) {
			await page.getByRole('button', { name: 'New Space' }).click();
			await page.getByRole('textbox', { name: 'Space Name' }).fill(SPACES.engineering);
			await page.getByRole('textbox', { name: /^Route/ }).fill('engineering');
		},
		crop: (page) => dialog(page),
	},
	{
		name: 'mark-picker-icon',
		framed: true,
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.raven}`,
		async crop(page) {
			const picker = await openMarkPicker(page, 'Icon');
			return [picker, page.getByRole('button', { name: 'Space actions' })];
		},
	},
	{
		name: 'mark-picker-upload',
		framed: true,
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.raven}`,
		crop: (page) => openMarkPicker(page, 'Upload'),
	},
	{
		name: 'access-panel',
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.handbook}`,
		crop: (page) => openSpaceSettings(page, 'Access'),
	},
	{
		name: 'reader-switcher',
		framed: true,
		user: 'kenji',
		url: '/raven/introduction/what-is-raven',
		async crop(page) {
			const toggle = page.getByRole('banner').getByRole('button', { name: 'Raven' });
			await toggle.click();
			const list = page.getByRole('banner').locator('[x-show="spaceSwitcherOpen"]');
			await list.waitFor();
			return [toggle, list];
		},
	},
	{
		name: 'navigation-panel',
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.raven}`,
		crop: (page) => openSpaceSettings(page, 'Navigation'),
	},
];
