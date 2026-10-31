import { openReaderMenu, scrollToTop, spaceIds, waitIdle } from '../lib.mjs';

export async function setup(run) {
	run.state = await spaceIds(run.api);
	run.state.channel = await run.api.pageId('raven/channels/create-a-channel');
}

const channelUrl = ({ state }) =>
	`/wiki-app/spaces/${state.raven}/page/${state.channel}`;

async function openPageSettings(page) {
	await page
		.getByRole('button', { name: 'Page settings', exact: true })
		.click();
	const panel = page.getByTestId('page-settings-panel');
	await panel.waitFor();
	await waitIdle(page);
	return panel;
}

export const shots = [
	{
		name: 'page-settings-social-preview',
		framed: true,
		cropHeight: 640,
		user: 'aisha',
		url: channelUrl,
		async crop(page) {
			const panel = await openPageSettings(page);
			await panel.getByLabel('Meta title').fill('Create a channel in Raven');
			await panel
				.getByLabel('Meta description')
				.fill(
					'Create a public, private or open channel in a Raven workspace and add people to it.',
				);
			await scrollToTop(panel.getByText('Social preview', { exact: true }), 60);
			await waitIdle(page);
			return panel;
		},
	},
	{
		name: 'page-settings-generated-card',
		framed: true,
		user: 'aisha',
		url: channelUrl,
		async crop(page) {
			const panel = await openPageSettings(page);
			const note = panel.getByText(/Auto-generated from the page metadata/);
			await note.scrollIntoViewIfNeeded();
			await panel.locator('img').last().waitFor();
			await page.waitForFunction(() =>
				[
					...document.querySelectorAll(
						'[data-testid="page-settings-panel"] img',
					),
				].every((image) => image.complete && image.naturalWidth),
			);
			await waitIdle(page);
			return [panel.getByText('Preview', { exact: true }), note];
		},
	},
	{
		name: 'disable-indexing-switch',
		framed: true,
		user: 'aisha',
		url: channelUrl,
		async crop(page) {
			const panel = await openPageSettings(page);
			const indexing = panel.getByRole('switch', { name: 'Disable Indexing' });
			await indexing.click();
			if ((await indexing.getAttribute('aria-checked')) !== 'true')
				throw new Error('Disable Indexing did not turn on');
			const header = panel.getByText('Page settings', { exact: true });
			return [
				header,
				panel.getByRole('switch', { name: 'Published' }),
				indexing,
				panel.getByText('Prevent search engines from indexing this page'),
			];
		},
		padding: 16,
	},
	{
		name: 'page-menu-ai-actions',
		user: 'guest',
		url: '/raven/channels/create-a-channel',
		async crop(page) {
			const menu = await openReaderMenu(page);
			return [page.locator('#wiki-page-title'), menu];
		},
	},
];
