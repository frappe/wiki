import {
	Api,
	CHANGE_REQUEST_API,
	assign,
	dialog,
	mainDownTo,
	openSpaceSettings,
	sidebarTop,
	spaceIds,
	unassign,
	waitForClone,
	waitIdle,
} from '../lib.mjs';

const CONFLICT_ROUTE = 'handbook-conflict-demo';

export async function setup(run) {
	const { api } = run;
	run.state = await spaceIds(api);
	run.state.devices = await api.pageId('handbook/it-and-security/devices');
	run.state.travel = await api.pageId(
		'handbook/pay-and-expenses/travel-policy',
	);
	run.state.firstWeek = await api.pageId('handbook/onboarding/your-first-week');
	run.state.kenji = await api.changeRequestId(
		'Offer Linux laptops to Platform and Data engineers',
	);
	run.state.fatima = await api.changeRequestId(
		'Add Maze and Dovetail to the tools list',
	);
}

const spaceUrl =
	(path) =>
	({ state }) =>
		`/wiki-app/spaces/${state.handbook}${path(state)}`;
const kenjiReview = spaceUrl((state) => `/change-requests/${state.kenji}`);

async function changesCard(page) {
	const card = page
		.getByRole('main')
		.getByText('Devices', { exact: true })
		.first();
	await card.waitFor();
	await waitIdle(page);
	return card.locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
}

async function deleteConflictSpace(api) {
	const space = await api.getValue('Wiki Space', { route: CONFLICT_ROUTE });
	if (space) await api.delete('Wiki Space', space);
}

/** Two change requests on a copy of the handbook that change the same table cell. */
async function createConflict({ api, state }) {
	await deleteConflictSpace(api);
	const grace = await Api.login('grace');
	await grace.call('run_doc_method', {
		dt: 'Wiki Space',
		dn: state.handbook,
		method: 'clone_wiki_space_in_background',
		args: JSON.stringify({ new_space_route: CONFLICT_ROUTE }),
	});
	state.conflictSpace = await waitForClone(api, state.handbook, CONFLICT_ROUTE);
	const docKey = await api.getValue(
		'Wiki Document',
		{ route: `${CONFLICT_ROUTE}/it-and-security/devices` },
		'doc_key',
	);

	const edit = async (title, refresh) => {
		const request = await grace.call(
			`${CHANGE_REQUEST_API}.create_change_request`,
			{ wiki_space: state.conflictSpace, title },
		);
		const { content } = await grace.call(`${CHANGE_REQUEST_API}.get_cr_page`, {
			name: request.name,
			doc_key: docKey,
		});
		await grace.call(`${CHANGE_REQUEST_API}.update_cr_page`, {
			name: request.name,
			doc_key: docKey,
			fields: { content: content.replace('Every 3 years', refresh) },
		});
		await grace.call(`${CHANGE_REQUEST_API}.submit_change_request`, {
			name: request.name,
		});
		await grace.call(`${CHANGE_REQUEST_API}.approve_change_request`, {
			name: request.name,
		});
		return request.name;
	};
	const first = await edit(
		'Refresh engineering laptops every 4 years',
		'Every 4 years',
	);
	state.conflict = await edit(
		'Refresh engineering laptops every 2 years',
		'Every 2 years',
	);
	await grace.call(`${CHANGE_REQUEST_API}.merge_change_request`, {
		name: first,
	});
	await grace.dispose();
}

export const shots = [
	{
		name: 'change-request-overview',
		user: 'priya',
		url: kenjiReview,
		async crop(page) {
			await changesCard(page);
			return mainDownTo(
				page,
				page.getByRole('main').getByText('Devices', { exact: true }).first(),
				40,
			);
		},
	},
	{
		name: 'draft-card',
		framed: true,
		user: 'ravi',
		url: spaceUrl((state) => `/page/${state.firstWeek}`),
		async crop(page) {
			await page.locator('.contribution-strip').waitFor();
			return sidebarTop(page, 3);
		},
	},
	{
		name: 'submit-dialog',
		user: 'ravi',
		url: spaceUrl((state) => `/page/${state.firstWeek}`),
		async crop(page) {
			await page
				.getByRole('main')
				.getByRole('button', { name: 'Submit for review' })
				.click();
			return dialog(page);
		},
	},
	{
		name: 'changes-requested-card',
		framed: true,
		user: 'liam',
		url: spaceUrl((state) => `/page/${state.travel}`),
		async crop(page) {
			await page.locator('.contribution-strip').waitFor();
			return sidebarTop(page, 0);
		},
	},
	{
		name: 'change-requests-page',
		user: 'priya',
		url: '/wiki-app/change-requests?tab=assigned',
		setup: ({ api, state }) => assign(api, state.kenji, 'priya'),
		teardown: ({ api, state }) => unassign(api, state.kenji, 'priya'),
		async steps(page) {
			await page
				.getByText('Offer Linux laptops to Platform and Data engineers')
				.waitFor();
		},
	},
	{
		name: 'review-side-by-side',
		user: 'priya',
		url: kenjiReview,
		async crop(page) {
			await page
				.getByRole('switch', { name: 'Show changes only' })
				.or(page.getByRole('main').getByRole('switch'))
				.first()
				.click();
			return mainDownTo(page, await changesCard(page));
		},
	},
	{
		name: 'merge-button',
		user: 'grace',
		url: spaceUrl((state) => `/change-requests/${state.fatima}`),
		async crop(page) {
			const title = page
				.getByRole('main')
				.getByText('Add Maze and Dovetail to the tools list')
				.last();
			await title.waitFor();
			return mainDownTo(
				page,
				page
					.getByRole('main')
					.getByText(/opened/)
					.first(),
				16,
			);
		},
	},
	{
		name: 'merge-conflicts',
		user: 'grace',
		url: ({ state }) =>
			`/wiki-app/spaces/${state.conflictSpace}/change-requests/${state.conflict}`,
		setup: createConflict,
		teardown: ({ api }) => deleteConflictSpace(api),
		async steps(page) {
			await page.getByRole('button', { name: 'Merge', exact: true }).click();
			await page
				.getByText(/Merge Conflicts/i)
				.first()
				.waitFor({ timeout: 120000 });
			await page.getByText('Devices', { exact: true }).last().click();
			await waitIdle(page);
		},
	},
	{
		name: 'version-history-panel',
		framed: true,
		user: 'kenji',
		url: spaceUrl((state) => `/page/${state.devices}`),
		async crop(page) {
			await page.getByRole('button', { name: 'Version history' }).click();
			await page
				.getByRole('tab', { name: 'All pages' })
				.or(page.getByRole('radio', { name: 'All pages' }))
				.first()
				.click();
			await waitIdle(page);
			return page.locator('#wiki-side-panel');
		},
	},
	{
		name: 'version-diff',
		user: 'kenji',
		url: spaceUrl((state) => `/page/${state.devices}`),
		async steps(page) {
			await page.getByRole('button', { name: 'Version history' }).click();
			await page
				.getByRole('tab', { name: 'This page' })
				.or(page.getByRole('radio', { name: 'This page' }))
				.first()
				.click();
			await waitIdle(page);
			await page
				.locator('#wiki-side-panel')
				.getByRole('button')
				.filter({ hasText: /merged/i })
				.first()
				.click();
			await page.getByText('Open change request').waitFor();
			await waitIdle(page);
		},
	},
	{
		name: 'accept-contributions',
		user: 'grace',
		url: spaceUrl(() => ''),
		crop: (page) => openSpaceSettings(page, 'Access'),
	},
	{
		name: 'space-change-requests-panel',
		framed: true,
		user: 'priya',
		url: spaceUrl((state) => `/page/${state.devices}`),
		async crop(page) {
			await page.getByRole('button', { name: /open on this page/ }).click();
			await waitIdle(page);
			return page.locator('#wiki-side-panel');
		},
	},
];
