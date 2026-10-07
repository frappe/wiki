import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod } from '../helpers';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

async function readCrPage(page: Page, docKey: string) {
	const crName = await page.evaluate(
		// @ts-expect-error test-only hook
		() => window.__draftStore.crName,
	);
	return callMethod<{ title: string; content: string }>(
		page.request,
		`${CR_METHOD}.get_cr_page`,
		{ name: crName, doc_key: docKey },
	);
}

function stallTree(page: Page) {
	const held: Route[] = [];
	page.route('**/api/method/**get_cr_tree*', (route) => {
		held.push(route);
	});
	return async () => {
		for (const route of held.splice(0)) await route.continue();
		await page.unroute('**/api/method/**get_cr_tree*');
	};
}

test.describe('Edit from the public page', () => {
	test('opens the editor while the sidebar tree is still loading', async ({
		page,
		wiki,
	}) => {
		const title = `Edit Fast ${Date.now()}`;
		const space = await wiki.space({
			pages: [{ title, content: 'Body before the tree lands.' }],
		});

		await page.goto(`/${space.page(title).route}`);
		const releaseTree = stallTree(page);
		const spaceListRequests: string[] = [];
		page.on('request', (request) => {
			if (request.url().includes('/document/Wiki%20Space?')) {
				spaceListRequests.push(request.url());
			}
		});
		await page.locator('a.wiki-edit-link:visible').first().click();

		const editor = page.locator('.ProseMirror[contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 15000 });
		await expect(editor).toContainText('Body before the tree lands.');
		await expect(page.locator('aside [role="treeitem"]')).toHaveCount(0);

		await releaseTree();
		await expect(
			page.locator('aside').getByText(title, { exact: true }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'New Space' })).toHaveCount(
			0,
		);
		expect(spaceListRequests).toEqual([]);
	});

	test('a save typed before the tree lands still reaches the server', async ({
		page,
		wiki,
	}) => {
		const title = `Early Save ${Date.now()}`;
		const typed = `typed early ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });
		const seeded = space.page(title);

		const releaseTree = stallTree(page);
		await page.goto(space.url('page', seeded.name));
		const editor = page.locator('.ProseMirror[contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 15000 });

		let treeReleased = false;
		let sentBeforeTree = false;
		page.on('request', (request) => {
			if (request.url().includes('apply_cr_operations') && !treeReleased) {
				sentBeforeTree = true;
			}
		});
		const batch = page.waitForResponse('**/api/method/**apply_cr_operations*');
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(` ${typed}`);
		await page.keyboard.press('ControlOrMeta+s');

		await page.waitForTimeout(1000);
		treeReleased = true;
		await releaseTree();
		const response = await batch;
		expect(sentBeforeTree).toBe(false);
		expect((await response.json()).message?.ok).toBe(true);
		const saved = await readCrPage(page, seeded.doc_key as string);
		expect(saved.content).toContain(typed);
	});

	test('a title changed before the tree lands is saved', async ({
		page,
		wiki,
	}) => {
		const title = `Early Title ${Date.now()}`;
		const renamed = `${title} renamed`;
		const space = await wiki.space({ pages: [{ title }] });
		const seeded = space.page(title);

		const releaseTree = stallTree(page);
		await page.goto(space.url('page', seeded.name));
		await expect(
			page.locator('.ProseMirror[contenteditable="true"]'),
		).toBeVisible({ timeout: 15000 });

		const titleInput = page.getByPlaceholder('Page title');
		await titleInput.fill(renamed);
		await titleInput.blur();
		await releaseTree();

		await expect(
			page.locator('aside').getByText(renamed, { exact: true }),
		).toBeVisible();
		await expect
			.poll(
				async () => (await readCrPage(page, seeded.doc_key as string)).title,
			)
			.toBe(renamed);
	});

	test('submit waits for a title change made before the tree loads', async ({
		page,
		wiki,
	}) => {
		const title = `Early Submit ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });
		const seeded = space.page(title);
		const editor = page.locator('.ProseMirror[contenteditable="true"]');

		await page.goto(space.url('page', seeded.name));
		await expect(editor).toBeVisible({ timeout: 15000 });
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' saved change');
		await page.keyboard.press('ControlOrMeta+s');
		await expect(page.getByTestId('sync-state-alert')).toBeHidden({
			timeout: 10000,
		});

		const releaseTree = stallTree(page);
		await page.reload();
		await expect(editor).toBeVisible({ timeout: 15000 });
		const titleInput = page.getByPlaceholder('Page title');
		await titleInput.fill(`${title} renamed`);
		await titleInput.blur();

		const submit = page.getByRole('button', { name: 'Submit for Review' });
		await expect(submit).toBeVisible();
		await expect(submit).toBeDisabled();

		await releaseTree();
		await expect(submit).toBeEnabled();
	});

	test('a failed tree load offers Reload latest, which unblocks submit', async ({
		page,
		wiki,
	}) => {
		const title = `Tree Retry ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });
		const editor = page.locator('.ProseMirror[contenteditable="true"]');

		await page.goto(space.url('page', space.page(title).name));
		await expect(editor).toBeVisible({ timeout: 15000 });
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' saved change');
		await page.keyboard.press('ControlOrMeta+s');
		await expect(page.getByTestId('sync-state-alert')).toBeHidden({
			timeout: 10000,
		});

		await page.route('**/api/method/**get_cr_tree*', (route) =>
			route.fulfill({ status: 500, body: '{}' }),
		);
		await page.reload();
		const reloadLatest = page.getByRole('button', {
			name: 'Reload latest',
			exact: true,
		});
		await expect(reloadLatest).toBeVisible({ timeout: 15000 });

		await page.unroute('**/api/method/**get_cr_tree*');
		await reloadLatest.click();
		await expect(
			page.getByRole('button', { name: 'Submit for Review' }),
		).toBeEnabled();
	});

	test('a save is held back when the tree fails to load', async ({
		page,
		wiki,
	}) => {
		const title = `Tree Fails ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });

		let batchSent = false;
		page.on('request', (request) => {
			if (request.url().includes('apply_cr_operations')) batchSent = true;
		});
		await page.route('**/api/method/**get_cr_tree*', (route) =>
			route.fulfill({ status: 500, body: '{}' }),
		);
		await page.goto(space.url('page', space.page(title).name));
		const editor = page.locator('.ProseMirror[contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' typed without a version');
		await page.keyboard.press('ControlOrMeta+s');

		await expect(
			page.getByRole('button', { name: 'Reload latest', exact: true }),
		).toBeVisible();
		expect(batchSent).toBe(false);
	});

	test('an unsaved draft of the page reopens after a reload', async ({
		page,
		wiki,
	}) => {
		const title = `Draft Reload ${Date.now()}`;
		const typed = `unsaved ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });

		await page.goto(space.url('page', space.page(title).name));
		const editor = page.locator('.ProseMirror[contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 15000 });
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(` ${typed}`);
		await page.waitForTimeout(800);

		await page.reload();
		await expect(editor).toContainText(typed, { timeout: 15000 });
		await expect(page.getByText('Unsaved changes')).toBeVisible();
	});
});
