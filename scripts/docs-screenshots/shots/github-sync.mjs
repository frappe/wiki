import { SPACES, columnOf, dialog, openSpaceSettings, openWikiSettings, syncSpace, waitIdle } from '../lib.mjs';

const IMAGE_PAGE = 'introduction/what-is-frappe-wiki';

/** The first synced space whose sync imported the images of the hero page. Frappe Wiki Docs comes first. */
async function spaceWithImages(api) {
	const spaces = await api.getList('Wiki Space', { filters: { git_synced: 1 }, fields: ['name', 'route', 'space_name'] });
	spaces.sort((a, b) => (b.space_name === SPACES.docs) - (a.space_name === SPACES.docs));
	for (const space of spaces) {
		const content = await api.getValue('Wiki Document', { route: `${space.route}/${IMAGE_PAGE}` }, 'content');
		if (content?.includes('/files/')) return space.route;
	}
	throw new Error('No synced space has imported the images yet. Push docs/images and sync the Frappe Wiki Docs space.');
}

export async function setup(run) {
	const { api, state } = run;
	state.space = await api.spaceId(SPACES.docs);
	state.route = await api.getValue('Wiki Space', { name: state.space }, 'route');
	state.page = await api.pageId(`${state.route}/github-sync/connect-a-repository`);
	state.imageRoute = await spaceWithImages(api);
	if (run.theme === 'light') {
		const logs = await api.getList('Wiki Git Sync Log', { filters: { wiki_space: state.space } });
		if (logs.length < 2) await syncSpace(api, state.space);
	}
}

const spaceUrl = ({ state }) => `/wiki-app/spaces/${state.space}`;

async function expandGroups(page, names) {
	for (const name of names) {
		const item = page.getByRole('treeitem', { name: `Expand ${name}` });
		if (await item.count()) await item.getByRole('button', { name: 'Expand' }).click();
	}
}

export const shots = [
	{
		name: 'github-app-settings',
		user: 'grace',
		url: '/wiki-app/spaces',
		crop: (page) => openWikiSettings(page, 'GitHub Sync'),
	},
	{
		name: 'new-space-github',
		framed: true,
		cropHeight: 720,
		user: 'admin',
		url: '/wiki-app/spaces',
		async crop(page) {
			await page.getByRole('button', { name: 'New Space' }).click();
			const create = dialog(page, 'Create Wiki Space');
			await create.getByRole('textbox', { name: 'Space Name' }).fill('Product Docs');
			await create.getByRole('checkbox', { name: 'Synced from GitHub?' }).click();
			await create.getByRole('textbox', { name: 'Select an account or organization' }).waitFor();
			await create.getByRole('textbox', { name: 'Search repositories…' }).click();
			await page.keyboard.type('wiki', { delay: 30 });
			await page.getByText(/^[\w-]+\/wiki$/).first().click();
			await create.getByText('Docs folder').waitFor();
			await waitIdle(page);
			await create.getByRole('heading').click();
			return create;
		},
	},
	{
		name: 'synced-sidebar',
		framed: true,
		user: 'grace',
		url: spaceUrl,
		async crop(page) {
			await expandGroups(page, ['Quick Start', 'GitHub Sync']);
			const collapse = page.getByRole('treeitem', { name: 'Collapse Introduction' });
			if (await collapse.count()) await collapse.getByRole('button', { name: 'Collapse' }).first().click();
			return columnOf(page.getByRole('button', { name: 'Space actions' }));
		},
	},
	{
		name: 'synced-page-image',
		user: 'grace',
		url: ({ state }) => `/${state.imageRoute}/${IMAGE_PAGE}`,
		async crop(page) {
			const image = page.locator('article img').first();
			await image.scrollIntoViewIfNeeded();
			await waitIdle(page);
			return [page.locator('#wiki-page-title'), image];
		},
	},
	{
		name: 'sync-strip',
		framed: true,
		user: 'grace',
		url: spaceUrl,
		async crop(page) {
			const line = page.getByText(/^Last synced/);
			await line.waitFor();
			const column = await columnOf(page.getByRole('button', { name: 'Space actions' }));
			const box = await line.boundingBox();
			return { x: column.x, y: 0, width: column.width, height: Math.ceil(box.y + box.height + 8) };
		},
	},
	{
		name: 'git-sync-panel',
		user: 'admin',
		url: spaceUrl,
		crop: (page) => openSpaceSettings(page, 'Git Sync'),
	},
	{
		name: 'edit-on-github',
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.space}/page/${state.page}`,
		async crop(page) {
			const button = page.getByRole('button', { name: 'Edit on GitHub' });
			await button.waitFor();
			const header = await columnOf(page.getByRole('main'));
			const box = await button.boundingBox();
			return { x: Math.floor(header.x), y: 0, width: Math.ceil(header.width), height: Math.ceil(box.y + box.height + 8) };
		},
	},
];
