import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures';

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
		expect((await response.json()).message?.ok).not.toBe(false);
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
