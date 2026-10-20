import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, saveEditor } from '../helpers';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

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

test.describe('Draft version conflict', () => {
	test('a stale tab cannot overwrite the page another tab saved', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
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

	test('reload latest keeps edits to pages nobody else changed', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Alpha', content: 'Alpha.' },
				{ title: 'Beta', content: 'Beta.' },
			],
		});
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
		await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

		await reloadLatest(tabB);
		await expect(tabB.locator('.ProseMirror').first()).toHaveText(
			'Beta. From B.',
		);
		await save(tabB);
		expect(await savedContent(tabB, beta.doc_key)).toBe('Beta. From B.');
		expect(await savedContent(tabB, alpha.doc_key)).toBe('Alpha. From A.');
	});

	test('a browser reload keeps the conflict until reload latest', async ({
		context,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Shared', content: 'Start.' }],
		});
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

	for (const recovery of ['Reload latest', 'a browser reload']) {
		test(`${recovery} keeps a rename made in another tab`, async ({
			context,
			wiki,
		}) => {
			const space = await wiki.space({
				pages: [{ title: 'Shared', content: 'Start.' }],
			});
			const shared = space.page('Shared');
			const url = space.url('page', shared.name);
			const tabA = await context.newPage();
			const tabB = await context.newPage();
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
			await expect(syncAlert(tabB)).toContainText('Changed elsewhere');

			if (recovery === 'Reload latest') await reloadLatest(tabB);
			else await openEditor(tabB, url);
			await expect(tabB.getByPlaceholder('Page title')).toHaveValue('Renamed');
			await save(tabB);
			expect(await savedPage(tabB, shared.doc_key)).toMatchObject({
				title: 'Renamed',
				content: 'Start. From B.',
			});
		});
	}
});
