import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, saveEditor } from '../helpers';
import type { WikiFactory } from '../helpers/factory';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

type MoveWindow = Window & {
	__draftStore: {
		rootKey: string;
		moveNode(move: {
			docKey: string;
			newParentKey: string;
			newIndex: number;
		}): void;
	};
};

type EditorWindow = Window & {
	wikiEditor?: unknown;
	__draftStore?: { crName: string | null };
};

async function openEditor(page: Page, url: string) {
	await page.goto(url);
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as EditorWindow).wikiEditor !== undefined,
	);
}

async function typeAtEnd(page: Page, text: string) {
	await page.locator('.ProseMirror').first().click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(text);
}

async function contentSaveSettled(page: Page) {
	return page.waitForResponse(
		(response) =>
			response.url().includes('apply_cr_operations') &&
			(response.request().postData() ?? '').includes('update_content'),
	);
}

async function savedPage(page: Page, docKey: string) {
	const crName = await page.evaluate(
		() => (window as EditorWindow).__draftStore?.crName,
	);
	return callMethod<{ title: string; content: string }>(
		page.request,
		`${CR_METHOD}.get_cr_page`,
		{ name: crName, doc_key: docKey },
	);
}

async function savedContent(page: Page, docKey: string) {
	return (await savedPage(page, docKey)).content;
}

function syncAlert(page: Page) {
	return page.getByTestId('sync-state-alert').first();
}

async function save(page: Page) {
	const settled = contentSaveSettled(page);
	await saveEditor(page);
	await settled;
}

async function reloadLatest(page: Page) {
	await page.getByRole('button', { name: 'Reload latest' }).first().click();
	await expect(page.getByText('Changed elsewhere')).toHaveCount(0);
}

async function twoTabsOnOnePage(context: BrowserContext, wiki: WikiFactory) {
	const space = await wiki.space({
		pages: [{ title: 'Shared', content: 'Start.' }],
	});
	await wiki.changeRequest(space);
	const shared = space.page('Shared');
	return {
		shared,
		url: space.url('page', shared.name),
		tabA: await context.newPage(),
		tabB: await context.newPage(),
	};
}

async function leaveSpaceAndComeBack(page: Page) {
	await page.getByRole('link', { name: 'Back to All Spaces' }).first().click();
	await page.waitForURL(/\/spaces\/?$/);
	await page.goBack();
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
}

async function openTreePage(page: Page, title: string) {
	await page.locator('aside').getByText(title, { exact: true }).click();
	await expect(page.locator('.ProseMirror').first()).toContainText(`${title}.`);
}

async function moveToTop(page: Page, docKey: string) {
	const settled = page.waitForResponse((response) =>
		response.url().includes('apply_cr_operations'),
	);
	await page.evaluate((key) => {
		const store = (window as MoveWindow).__draftStore;
		store.moveNode({ docKey: key, newParentKey: store.rootKey, newIndex: 0 });
	}, docKey);
	await settled;
}

test.describe('Draft version conflict', () => {
	test('a stale tab cannot overwrite the page another tab saved', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
		await wiki.changeRequest(space);
		const shared = space.page('Shared');
		const url = space.url('page', shared.name);
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await typeAtEnd(tabA, ' From A.');
		await save(tabA);

		await typeAtEnd(tabB, ' From B.');
		await save(tabB);
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		const sent: string[] = [];
		tabB.on('request', (request) => {
			if (request.url().includes('apply_cr_operations'))
				sent.push(request.url());
		});
		await typeAtEnd(tabB, ' More B.');
		await saveEditor(tabB);
		// Blocked saves fail in the client, so there is no response to wait on.
		await tabB.waitForTimeout(1000);
		expect(sent).toEqual([]);
		expect(await savedContent(tabA, shared.doc_key)).toBe('Start. From A.');
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		await reloadLatest(tabB);
		await expect(tabB.locator('.ProseMirror').first()).toHaveText(
			'Start. From A.',
		);
		await typeAtEnd(tabB, ' After reload.');
		await save(tabB);
		expect(await savedContent(tabB, shared.doc_key)).toBe(
			'Start. From A. After reload.',
		);
	});

	test('two tabs on different pages both save', async ({ context, wiki }) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Alpha', content: 'Alpha.' },
				{ title: 'Beta', content: 'Beta.' },
			],
		});
		await wiki.changeRequest(space);
		const alpha = space.page('Alpha');
		const beta = space.page('Beta');
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		await openEditor(tabA, space.url('page', alpha.name));
		await openEditor(tabB, space.url('page', beta.name));

		await typeAtEnd(tabA, ' From A.');
		await save(tabA);
		await typeAtEnd(tabB, ' From B.');
		await save(tabB);

		await expect(tabB.getByText('Changed elsewhere')).toHaveCount(0);
		expect(await savedContent(tabB, alpha.doc_key)).toBe('Alpha. From A.');
		expect(await savedContent(tabB, beta.doc_key)).toBe('Beta. From B.');
	});

	test('a conflict on one page leaves other pages saving', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Shared', content: 'Start.' },
				{ title: 'Other', content: 'Other.' },
			],
		});
		await wiki.changeRequest(space);
		const shared = space.page('Shared');
		const other = space.page('Other');
		const url = space.url('page', shared.name);
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await typeAtEnd(tabA, ' From A.');
		await save(tabA);
		await typeAtEnd(tabB, ' From B.');
		await save(tabB);
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		await openTreePage(tabB, 'Other');
		await typeAtEnd(tabB, ' Still saving.');
		await save(tabB);

		expect(await savedContent(tabB, other.doc_key)).toBe(
			'Other. Still saving.',
		);
		expect(await savedContent(tabB, shared.doc_key)).toBe('Start. From A.');
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');
	});

	test('leaving the space and coming back shows the edit another tab saved', async ({
		context,
		wiki,
	}) => {
		const { url, shared, tabA, tabB } = await twoTabsOnOnePage(context, wiki);
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await typeAtEnd(tabB, ' From B.');
		await save(tabB);

		await leaveSpaceAndComeBack(tabA);
		await expect(tabA.locator('.ProseMirror').first()).toHaveText(
			'Start. From B.',
		);
		await typeAtEnd(tabA, ' From A.');
		await save(tabA);

		await expect(tabA.getByText('Changed elsewhere')).toHaveCount(0);
		expect(await savedContent(tabA, shared.doc_key)).toBe(
			'Start. From B. From A.',
		);
	});

	test('leaving the space with unsaved typing keeps it and cannot overwrite', async ({
		context,
		wiki,
	}) => {
		const { url, shared, tabA, tabB } = await twoTabsOnOnePage(context, wiki);
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await typeAtEnd(tabB, ' From B.');
		await save(tabB);
		await typeAtEnd(tabA, ' From A.');

		await leaveSpaceAndComeBack(tabA);
		await expect(tabA.locator('.ProseMirror').first()).toHaveText(
			'Start. From A.',
		);
		await saveEditor(tabA);

		await expect(syncAlert(tabA)).toContainText('Changed elsewhere');
		expect(await savedContent(tabA, shared.doc_key)).toBe('Start. From B.');
	});

	test('a save whose reply was lost does not read as a conflict', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
		await wiki.changeRequest(space);
		const shared = space.page('Shared');
		await openEditor(page, space.url('page', shared.name));

		let dropped = false;
		await page.route('**/*apply_cr_operations*', async (route) => {
			if (dropped) return route.continue();
			dropped = true;
			await route.fetch();
			await route.abort('connectionreset');
		});
		await typeAtEnd(page, ' One.');
		await saveEditor(page);
		await expect(syncAlert(page)).toContainText('Sync failed');
		expect(await savedContent(page, shared.doc_key)).toBe('Start. One.');

		await typeAtEnd(page, ' Two.');
		await saveEditor(page);

		await expect(page.getByTestId('sync-state-alert')).toBeHidden();
		expect(await savedContent(page, shared.doc_key)).toBe('Start. One. Two.');
	});

	test('a stale move conflicts and reload latest clears it', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Alpha', content: 'Alpha.' },
				{ title: 'Beta', content: 'Beta.' },
			],
		});
		await wiki.changeRequest(space);
		const alpha = space.page('Alpha');
		const beta = space.page('Beta');
		const url = space.url('page', alpha.name);
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await moveToTop(tabA, beta.doc_key);
		await moveToTop(tabB, alpha.doc_key);
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		await reloadLatest(tabB);
		await moveToTop(tabB, alpha.doc_key);
		await expect(tabB.getByText('Changed elsewhere')).toHaveCount(0);
	});

	test('a browser reload keeps the conflict until reload latest', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
		await wiki.changeRequest(space);
		const shared = space.page('Shared');
		const url = space.url('page', shared.name);
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		await typeAtEnd(tabA, ' From A.');
		await save(tabA);
		await typeAtEnd(tabB, ' From B.');
		await save(tabB);
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		await openEditor(tabB, url);
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');
		await expect(tabB.locator('.ProseMirror').first()).toHaveText(
			'Start. From B.',
		);
		expect(await savedContent(tabA, shared.doc_key)).toBe('Start. From A.');

		await reloadLatest(tabB);
		await expect(tabB.locator('.ProseMirror').first()).toHaveText(
			'Start. From A.',
		);
	});

	test('a content save keeps a rename made in another tab', async ({
		context,
		wiki,
	}) => {
		const { url, shared, tabA, tabB } = await twoTabsOnOnePage(context, wiki);
		await openEditor(tabA, url);
		await openEditor(tabB, url);

		const renamed = tabA.waitForResponse(
			(response) =>
				response.url().includes('apply_cr_operations') &&
				(response.request().postData() ?? '').includes('update_node'),
		);
		const titleInput = tabA.getByPlaceholder('Page title');
		await titleInput.fill('Renamed');
		await titleInput.blur();
		await renamed;

		await typeAtEnd(tabB, ' From B.');
		await save(tabB);

		await expect(tabB.getByText('Changed elsewhere')).toHaveCount(0);
		expect(await savedPage(tabB, shared.doc_key)).toMatchObject({
			title: 'Renamed',
			content: 'Start. From B.',
		});
	});

	test('a title still typing goes out with the autosave', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
		await wiki.changeRequest(space);
		const shared = space.page('Shared');
		await openEditor(page, space.url('page', shared.name));

		await typeAtEnd(page, ' Body.');
		await page.getByPlaceholder('Page title').fill('Typed title');
		await expect
			.poll(async () => (await savedPage(page, shared.doc_key)).title, {
				timeout: 15000,
			})
			.toBe('Typed title');
	});
});
