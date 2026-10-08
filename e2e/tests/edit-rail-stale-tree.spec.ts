import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loginViaAPI } from '../helpers/auth';
import { newPageButton } from '../helpers/wiki';

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

function treeSnapshotKeys(page: Page) {
	return page.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				const open = indexedDB.open('wiki-drafts');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const request = open.result
						.transaction('drafts')
						.objectStore('drafts')
						.getAllKeys();
					request.onsuccess = () =>
						resolve(
							(request.result as IDBValidKey[])
								.map(String)
								.filter((key) => key.startsWith('tree:')),
						);
				};
			}),
	);
}

function addRowToSnapshot(page: Page, key: string, title: string) {
	return page.evaluate(
		([key, title]) =>
			new Promise<void>((resolve, reject) => {
				const open = indexedDB.open('wiki-drafts');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const store = open.result
						.transaction('drafts', 'readwrite')
						.objectStore('drafts');
					const read = store.get(key);
					read.onsuccess = () => {
						const tree = read.result;
						const [first] = tree.children;
						tree.children.push({
							...first,
							doc_key: 'snapshot-only-row',
							document_name: null,
							title,
							label: title,
							children: [],
						});
						const write = store.put(tree, key);
						write.onsuccess = () => resolve();
						write.onerror = () => reject(write.error);
					};
				};
			}),
		[key, title],
	);
}

test.describe('Editor rail from the last visit', () => {
	test('paints the last tree read-only, then swaps in the fresh one', async ({
		page,
		wiki,
	}) => {
		const title = `Stale Rail ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });
		const snapshotKey = `tree:Administrator:${space.name}`;
		const rail = page.getByRole('complementary');

		await page.goto(space.url('page', space.page(title).name));
		await expect(rail.getByText(title, { exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect.poll(() => treeSnapshotKeys(page)).toContain(snapshotKey);
		await addRowToSnapshot(page, snapshotKey, 'Only In The Snapshot');

		const releaseTree = stallTree(page);
		await page.reload();
		await expect(
			rail.getByText('Only In The Snapshot', { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(rail.getByText(title, { exact: true })).toBeVisible();
		await expect(newPageButton(page)).toHaveCount(0);

		await releaseTree();
		await expect(newPageButton(page)).toBeVisible();
		await expect(rail.getByText(title, { exact: true })).toBeVisible();
		await expect(
			rail.getByText('Only In The Snapshot', { exact: true }),
		).toHaveCount(0);
	});

	test('logging out clears the saved trees', async ({ page, wiki }) => {
		const title = `Logout Rail ${Date.now()}`;
		const space = await wiki.space({ pages: [{ title }] });
		await loginViaAPI(page.request);

		await page.goto(space.url('page', space.page(title).name));
		await expect(
			page.getByRole('complementary').getByText(title, { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect
			.poll(() => treeSnapshotKeys(page))
			.toContain(`tree:Administrator:${space.name}`);

		await page.keyboard.press('ControlOrMeta+k');
		const palette = page.getByRole('dialog');
		await palette.getByRole('combobox').fill('log out');
		await palette.getByRole('option', { name: /Log out/ }).click();
		await page.waitForURL(/\/login/);

		expect(await treeSnapshotKeys(page)).toEqual([]);
	});
});
