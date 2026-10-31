import {
	caretAtEnd,
	columnOf,
	deleteDrafts,
	dialog,
	endOfSection,
	scrollToTop,
	spaceIds,
	startEditing,
	waitIdle,
	waitSaved,
} from '../lib.mjs';

const DRAFT = 'Update device rules';
const DRAFT_DESCRIPTION =
	'Add the Linux laptop option and the 48-hour update rule.';

export async function setup(run) {
	const { api } = run;
	run.state = await spaceIds(api);
	run.state.devices = await api.pageId('handbook/it-and-security/devices');
	run.state.expenses = await api.pageId(
		'handbook/pay-and-expenses/expense-policy',
	);
	run.state.incident = await api.pageId(
		'handbook/it-and-security/report-a-security-incident',
	);
	await deleteDrafts(api, 'grace', run.state.handbook, [DRAFT]);
}

export async function teardown({ api, state }) {
	await deleteDrafts(api, 'grace', state.handbook, [DRAFT]);
}

const pageUrl =
	(key) =>
	({ state }) =>
		`/wiki-app/spaces/${state.handbook}/page/${state[key]}`;
async function editing(page) {
	await startEditing(page, DRAFT, DRAFT_DESCRIPTION);
	await waitSaved(page);
}

export const shots = [
	{
		name: 'new-change-request',
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await page
				.getByRole('main')
				.getByRole('button', { name: 'Edit', exact: true })
				.click();
			const newRequest = dialog(page, 'New change request');
			await newRequest.getByLabel(/^Title/).fill(DRAFT);
			await newRequest.getByLabel('Description').fill(DRAFT_DESCRIPTION);
			return newRequest;
		},
		async teardown(run, page) {
			await dialog(page, 'New change request')
				.getByRole('button', { name: 'Start editing' })
				.click();
			await page.locator('.wiki-toolbar').waitFor();
			await waitIdle(page);
		},
	},
	{
		name: 'editor-layout',
		user: 'grace',
		url: pageUrl('devices'),
		async steps(page) {
			await editing(page);
			const last = page.locator('.ProseMirror > p').last();
			await last.click();
			await page.keyboard.press('End');
			await page.keyboard.type(' Ask IT if you need a Linux laptop.');
			await page
				.getByTestId('sync-state-alert')
				.waitFor({ timeout: 5000 })
				.catch(() => {});
			await waitSaved(page);
			await scrollToTop(page.locator('.ProseMirror > *').first(), 10000);
			await page.mouse.move(1000, 500);
		},
	},
	{
		name: 'toolbar',
		user: 'grace',
		url: pageUrl('devices'),
		steps: editing,
		crop: (page) => page.locator('.wiki-toolbar'),
		padding: 4,
	},
	{
		name: 'slash-menu',
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await editing(page);
			await scrollToTop(
				page
					.locator('.ProseMirror')
					.getByRole('heading', { name: 'Personal devices' }),
				150,
			);
			const block = await endOfSection(page, 'Personal devices');
			await caretAtEnd(block);
			await page.keyboard.press('Enter');
			await page.keyboard.type('/');
			const menu = page.locator('.slash-commands-list');
			await menu.waitFor();
			const slash = await block.evaluate(
				(element) => element.nextElementSibling?.textContent,
			);
			if (slash !== '/')
				throw new Error(`The slash went to the wrong place: "${slash}"`);
			return [menu, block];
		},
		padding: 40,
		async teardown(run, page) {
			await page.keyboard.press('Escape');
			await page.keyboard.press('Backspace');
			await page.keyboard.press('Backspace');
		},
	},
	{
		name: 'callout',
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await editing(page);
			const callout = page
				.locator('.callout-block-wrapper')
				.filter({ hasText: 'lost or stolen' })
				.first();
			await scrollToTop(callout, 200);
			await callout.hover();
			return callout;
		},
	},
	{
		name: 'image-menu',
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await editing(page);
			const image = page.locator('.ProseMirror img').first();
			await scrollToTop(image, 150);
			await image.click();
			await page.getByRole('button', { name: 'Image options' }).click();
			const menu = page.getByRole('menu').last();
			await menu.waitFor();
			await menu.getByText('Replace image').hover();
			await page.getByText('For dark mode').waitFor();
			return [
				image,
				menu,
				page
					.getByText('For dark mode')
					.locator('xpath=ancestor::*[@role="menu"][1]'),
			];
		},
		padding: 6,
	},
	{
		name: 'diagram-block',
		user: 'grace',
		url: pageUrl('expenses'),
		async crop(page) {
			await editing(page);
			const block = page.locator('.mermaid-block').first();
			await scrollToTop(block, 120);
			await waitIdle(page);
			return block;
		},
	},
	{
		name: 'diagram-published',
		user: 'kenji',
		url: '/handbook/pay-and-expenses/expense-policy',
		async crop(page) {
			const diagram = page.locator('article .mermaid').first();
			await diagram.locator('svg').first().waitFor();
			await scrollToTop(diagram, 120);
			return diagram;
		},
	},
	{
		name: 'pdf-card',
		user: 'kenji',
		isMostlyContent: true,
		url: '/handbook/pay-and-expenses/expense-policy',
		async crop(page) {
			const card = page.locator('.wiki-pdf-embed').first();
			await scrollToTop(card, 120);
			await card.locator('canvas').first().waitFor();
			await waitIdle(page);
			return card;
		},
	},
	{
		name: 'page-link-picker',
		user: 'grace',
		url: pageUrl('incident'),
		async crop(page) {
			await editing(page);
			const paragraph = page.locator('.ProseMirror > p').first();
			await caretAtEnd(paragraph);
			await page.keyboard.type(' See [[dev', { delay: 40 });
			const list = page
				.getByText('Link to “dev”')
				.locator('xpath=ancestor::*[contains(@class,"w-[340px]")][1]');
			await list.waitFor();
			await waitIdle(page);
			return [
				list,
				paragraph,
				paragraph.locator('xpath=preceding-sibling::*[1]'),
			];
		},
		async teardown(run, page) {
			await page.keyboard.press('Escape');
			for (let i = 0; i < ' See [[dev'.length; i++)
				await page.keyboard.press('Backspace');
		},
	},
	{
		name: 'create-page-dialog',
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await editing(page);
			const row = page
				.getByRole('treeitem', { name: /IT and security/ })
				.locator('.frappe-tree-row')
				.first();
			await row.hover();
			await row.getByRole('button').last().click();
			await page.getByRole('menuitem', { name: 'New Page' }).click();
			const create = dialog(page, 'Create New Page');
			await create.getByLabel('Title').fill('Linux laptops');
			return create;
		},
		async teardown(run, page) {
			await dialog(page, 'Create New Page')
				.getByRole('button', { name: 'Cancel' })
				.click();
		},
	},
	{
		name: 'tree-drag',
		framed: true,
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			const column = await columnOf(
				page.getByRole('textbox', { name: 'Search pages...' }),
			);
			const label = await page.locator('.frappe-tree-drag-label').boundingBox();
			return {
				...column,
				width: Math.ceil(
					Math.max(column.width, label.x + label.width + 8 - column.x),
				),
			};
		},
		async steps(page) {
			await editing(page);
			const expanded = page.getByRole('treeitem', {
				name: 'Collapse Pay and expenses',
			});
			if (await expanded.count())
				await expanded
					.getByRole('button', { name: 'Collapse' })
					.first()
					.click();
			const source = page
				.getByRole('treeitem', { name: /^Devices/ })
				.locator('.frappe-tree-row')
				.first();
			const target = page
				.getByRole('treeitem', { name: /Performance and growth/ })
				.locator('.frappe-tree-row')
				.first();
			await page.mouse.move(700, 880);
			const transfer = await page.evaluateHandle(() => new DataTransfer());
			await source.dispatchEvent('dragstart', { dataTransfer: transfer });
			const box = await target.boundingBox();
			await target.dispatchEvent('dragover', {
				dataTransfer: transfer,
				clientX: box.x + 16,
				clientY: box.y + box.height / 2,
			});
		},
		async teardown(run, page) {
			const source = page
				.getByRole('treeitem', { name: /^Devices/ })
				.locator('.frappe-tree-row')
				.first();
			await source.dispatchEvent('dragend');
		},
	},
	{
		name: 'page-settings',
		framed: true,
		user: 'grace',
		url: pageUrl('devices'),
		async crop(page) {
			await editing(page);
			await page.getByRole('button', { name: 'Page settings' }).click();
			const panel = page.getByTestId('page-settings-panel');
			await panel.waitFor();
			await waitIdle(page);
			return panel;
		},
		padding: 0,
	},
];
