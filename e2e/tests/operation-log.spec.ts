import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, failMethod, saveEditor } from '../helpers';
import type { WikiFactory } from '../helpers/factory';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';
const BATCH = '**/*apply_cr_operations*';

type TreeNode = {
	doc_key: string;
	title: string;
	is_deleted?: number | boolean;
	children: TreeNode[];
};
type ServerTree = {
	operation_version: number;
	children: TreeNode[];
};
type StoreWindow = Window & {
	wikiEditor?: unknown;
	__draftStore: {
		crName: string;
		rootKey: string;
		hasLoadedTree: boolean;
		hasPendingMutations: boolean;
		findNode(docKey: string): { title: string; isDeleted?: boolean } | null;
		treeAsLegacy: { children: TreeNode[] };
		renameNode(docKey: string, title: string): Promise<void>;
		deleteNode(docKey: string): Promise<void>;
		moveNode(move: {
			docKey: string;
			newParentKey: string;
			newIndex: number;
		}): void;
		createNode(node: { parentKey: string | null; title: string }): {
			docKey: string;
			promise: Promise<string>;
		};
	};
};

async function openDraft(page: Page, wiki: WikiFactory) {
	const space = await wiki.space({
		pages: [
			{ title: 'Alpha', content: 'Alpha.' },
			{ title: 'Beta', content: 'Beta.' },
		],
	});
	await wiki.changeRequest(space);
	const alpha = space.page('Alpha');
	await page.goto(space.url('page', alpha.name));
	await waitForDraft(page);
	const crName = await page.evaluate(
		() => (window as unknown as StoreWindow).__draftStore.crName,
	);
	return { space, crName, alpha, beta: space.page('Beta') };
}

async function waitForDraft(page: Page) {
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as unknown as StoreWindow).__draftStore?.hasLoadedTree,
	);
}

function serverTree(page: Page, crName: string) {
	return callMethod<ServerTree>(page.request, `${CR_METHOD}.get_cr_tree`, {
		name: crName,
	});
}

async function serverNode(page: Page, crName: string, docKey: string) {
	const tree = await serverTree(page, crName);
	return tree.children.find((node) => node.doc_key === docKey);
}

function goOffline(page: Page) {
	return page.route(BATCH, (route) => route.abort('connectionfailed'));
}

function rename(page: Page, docKey: string, title: string) {
	return page.evaluate(
		([key, name]) => {
			(window as unknown as StoreWindow).__draftStore
				.renameNode(key, name)
				.catch(() => {});
		},
		[docKey, title],
	);
}

function moveToTop(page: Page, docKey: string) {
	return page.evaluate((key) => {
		const store = (window as unknown as StoreWindow).__draftStore;
		store.moveNode({ docKey: key, newParentKey: store.rootKey, newIndex: 0 });
	}, docKey);
}

function localNode(page: Page, docKey: string) {
	return page.evaluate(
		(key) => (window as unknown as StoreWindow).__draftStore.findNode(key),
		docKey,
	);
}

async function expectLogDrained(page: Page) {
	await page.waitForFunction(
		() => !(window as unknown as StoreWindow).__draftStore.hasPendingMutations,
		undefined,
		{ timeout: 20000 },
	);
}

test.describe('Durable operation log', () => {
	test('an offline rename survives a reload and reaches the server', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);
		await goOffline(page);

		await rename(page, beta.doc_key, 'Beta renamed');
		await page.reload();
		await waitForDraft(page);
		expect((await localNode(page, beta.doc_key))?.title).toBe('Beta renamed');
		expect((await serverNode(page, crName, beta.doc_key))?.title).toBe('Beta');
		await page
			.locator('aside')
			.getByText('Beta renamed', { exact: true })
			.click();
		await expect(page.getByPlaceholder('Page title')).toHaveValue(
			'Beta renamed',
		);

		await page.unroute(BATCH);
		await expect
			.poll(async () => (await serverNode(page, crName, beta.doc_key))?.title, {
				timeout: 20000,
			})
			.toBe('Beta renamed');
		await expectLogDrained(page);
	});

	test('an offline delete survives a reload and reaches the server', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);
		await goOffline(page);

		await page.evaluate((key) => {
			(window as unknown as StoreWindow).__draftStore
				.deleteNode(key)
				.catch(() => {});
		}, beta.doc_key);
		await page.reload();
		await waitForDraft(page);
		expect((await localNode(page, beta.doc_key))?.isDeleted).toBe(true);

		await page.unroute(BATCH);
		await expect
			.poll(
				async () =>
					Boolean((await serverNode(page, crName, beta.doc_key))?.is_deleted),
				{ timeout: 20000 },
			)
			.toBe(true);
		await expectLogDrained(page);
	});

	test('an offline create keeps its page and text through a reload', async ({
		page,
		wiki,
	}) => {
		const { crName } = await openDraft(page, wiki);
		await goOffline(page);

		const docKey = await page.evaluate(() => {
			const store = (window as unknown as StoreWindow).__draftStore;
			const created = store.createNode({
				parentKey: store.rootKey,
				title: 'Made offline',
			});
			created.promise.catch(() => {});
			return created.docKey;
		});
		await page
			.locator('aside')
			.getByText('Made offline', { exact: true })
			.click();
		await page.waitForURL(new RegExp(`/draft/${docKey}$`));
		await page.locator('.ProseMirror').first().click();
		await page.keyboard.type('Typed offline.');
		await page.waitForTimeout(1000);

		await page.reload();
		await waitForDraft(page);
		await expect(page.getByText('Draft not found')).toHaveCount(0);
		await expect(page.locator('.ProseMirror').first()).toHaveText(
			'Typed offline.',
			{ timeout: 15000 },
		);
		await expect(
			page.locator('aside').getByText('Made offline', { exact: true }),
		).toHaveCount(1);

		await page.unroute(BATCH);
		await expect
			.poll(async () => (await serverNode(page, crName, docKey))?.title, {
				timeout: 20000,
			})
			.toBe('Made offline');
		await saveEditor(page);
		await expect
			.poll(
				async () =>
					(
						await callMethod<{ content: string }>(
							page.request,
							`${CR_METHOD}.get_cr_page`,
							{ name: crName, doc_key: docKey },
						)
					).content,
				{ timeout: 15000 },
			)
			.toBe('Typed offline.');
	});

	test('a move followed by an immediate reload still lands', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);

		await moveToTop(page, beta.doc_key);
		await page.reload();
		await waitForDraft(page);

		await expect
			.poll(async () => (await serverTree(page, crName)).children[0]?.doc_key, {
				timeout: 20000,
			})
			.toBe(beta.doc_key);
		await expectLogDrained(page);
	});

	test('a rename whose reply was lost is sent again and applied once', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);
		const before = (await serverTree(page, crName)).operation_version;
		let requests = 0;
		await page.route(BATCH, async (route) => {
			requests += 1;
			if (requests > 1) return route.continue();
			await route.fetch();
			await route.abort('connectionreset');
		});

		await rename(page, beta.doc_key, 'Beta once');
		await expect.poll(() => requests, { timeout: 20000 }).toBe(2);
		await expectLogDrained(page);

		const after = await serverTree(page, crName);
		expect(after.operation_version).toBe(before + 1);
		expect(
			after.children.find((node) => node.doc_key === beta.doc_key)?.title,
		).toBe('Beta once');
	});

	test('a move after a lost create reply is not a false conflict', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);
		let dropped = false;
		await page.route(BATCH, async (route) => {
			if (dropped) return route.continue();
			dropped = true;
			await route.fetch();
			await route.abort('connectionreset');
		});

		await page.evaluate(() => {
			const store = (window as unknown as StoreWindow).__draftStore;
			store
				.createNode({ parentKey: store.rootKey, title: 'Lost reply' })
				.promise.catch(() => {});
		});
		await expectLogDrained(page);
		await moveToTop(page, beta.doc_key);
		await expectLogDrained(page);

		await expect(page.getByText('Changed elsewhere')).toHaveCount(0);
		await expect
			.poll(async () => (await serverTree(page, crName)).children[0]?.doc_key)
			.toBe(beta.doc_key);
	});

	test('a rejected rename drops out and the tree matches the server', async ({
		page,
		wiki,
	}) => {
		const { crName, beta } = await openDraft(page, wiki);
		const unroute = await failMethod(
			page,
			`${CR_METHOD}.apply_cr_operations`,
			'Mocked rejection',
		);

		await rename(page, beta.doc_key, 'Rejected');
		await expect
			.poll(async () => (await localNode(page, beta.doc_key))?.title, {
				timeout: 10000,
			})
			.toBe('Beta');
		await expectLogDrained(page);
		await unroute();

		await page.reload();
		await waitForDraft(page);
		expect((await localNode(page, beta.doc_key))?.title).toBe('Beta');
		expect((await serverNode(page, crName, beta.doc_key))?.title).toBe('Beta');
	});

	test('a move held by a conflict stays held across a reload until reload latest', async ({
		context,
		wiki,
	}) => {
		const tabA = await context.newPage();
		const tabB = await context.newPage();
		const { crName, space, alpha, beta } = await openDraft(tabA, wiki);
		await tabB.goto(space.url('page', alpha.name));
		await waitForDraft(tabB);

		await moveToTop(tabA, beta.doc_key);
		await expectLogDrained(tabA);
		await moveToTop(tabB, alpha.doc_key);
		await expect(tabB.getByTestId('sync-state-alert').first()).toContainText(
			'Changed elsewhere',
			{ timeout: 10000 },
		);

		await tabB.reload();
		await waitForDraft(tabB);
		await expect(tabB.getByTestId('sync-state-alert').first()).toContainText(
			'Changed elsewhere',
			{ timeout: 10000 },
		);
		expect((await serverTree(tabB, crName)).children[0]?.doc_key).toBe(
			beta.doc_key,
		);

		await tabB.getByRole('button', { name: 'Reload latest' }).first().click();
		await expect(tabB.getByText('Changed elsewhere')).toHaveCount(0);
		await expect
			.poll(() =>
				tabB.evaluate(
					() =>
						(window as unknown as StoreWindow).__draftStore.treeAsLegacy
							.children[0]?.doc_key,
				),
			)
			.toBe(beta.doc_key);

		await tabB.reload();
		await waitForDraft(tabB);
		await expect(tabB.getByText('Changed elsewhere')).toHaveCount(0);
		expect((await serverTree(tabB, crName)).children[0]?.doc_key).toBe(
			beta.doc_key,
		);
	});
});
