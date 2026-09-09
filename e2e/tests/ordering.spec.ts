import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { PageSpec, SeededSpace } from '../helpers/factory';
import { callMethod } from '../helpers/frappe';
import { clickSidebarAddOption } from '../helpers/wiki';

/**
 * E2E tests for wiki document ordering functionality.
 * Tests that:
 * 1. New documents appear at the bottom of the list
 * 2. Reordering documents persists after page refresh
 * 3. Order is consistent between admin and public-facing views
 */

/**
 * A group per name, each holding one published page — a bare group is hidden
 * from the public sidebar, so the child is what makes the order observable
 * there.
 */
function groupsWithAPageEach(names: string[]): PageSpec[] {
	return names.map((name) => ({
		title: name,
		is_group: true,
		children: [{ title: `${name} Page` }],
	}));
}

/** The order the named groups appear in, read off rendered text. */
async function orderIn(page: Page, selector: string, names: string[]) {
	const text = await page.locator(selector).innerText();
	return names
		.filter((name) => text.includes(name))
		.sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

/** Move `names[from]` to the head of its siblings, through the reorder API. */
async function moveToFront(
	request: Parameters<typeof callMethod>[0],
	space: SeededSpace,
	names: string[],
	from: number,
) {
	const siblings = names.map((name) => space.page(name).name);
	const [moved] = siblings.splice(from, 1);
	await callMethod(request, 'wiki.api.wiki_space.reorder_wiki_documents', {
		doc_name: moved,
		new_parent: space.rootGroup,
		new_index: 0,
		siblings: JSON.stringify([moved, ...siblings]),
	});
}

test.describe('Wiki Document Ordering', () => {
	test('new document should appear at bottom of sidebar', async ({
		page,
		wiki,
	}) => {
		const names = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
		const space = await wiki.space({ pages: groupsWithAPageEach(names) });

		await page.goto(space.url());
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=Q1', { timeout: 10000 });

		expect(await orderIn(page, 'aside', names)).toEqual(names);

		await clickSidebarAddOption(page, 'New Group');
		await page.getByLabel('Title').fill('Q6');
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page.locator('aside').getByText('Q6')).toBeVisible({
			timeout: 10000,
		});

		// Q6 lands at the end, not the beginning.
		expect(await orderIn(page, 'aside', [...names, 'Q6'])).toEqual([
			...names,
			'Q6',
		]);
	});

	test('reorder should persist after page refresh', async ({
		page,
		wiki,
		request,
	}) => {
		const names = ['Folder1', 'Folder2', 'Folder3', 'Folder4', 'Folder5'];
		const space = await wiki.space({ pages: groupsWithAPageEach(names) });

		await page.goto(space.url());
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=Folder1', { timeout: 10000 });
		expect(await orderIn(page, 'aside', names)).toEqual(names);

		await moveToFront(request, space, names, 4);

		await page.reload();
		await page.waitForLoadState('networkidle');
		expect(await orderIn(page, 'aside', names)).toEqual([
			'Folder5',
			'Folder1',
			'Folder2',
			'Folder3',
			'Folder4',
		]);
	});

	test('order should be consistent between admin and public views', async ({
		page,
		wiki,
	}) => {
		const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
		const space = await wiki.space({ pages: groupsWithAPageEach(names) });

		await page.goto(space.url());
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=Alpha', { timeout: 10000 });
		const adminOrder = await orderIn(page, 'aside', names);

		await page.goto(`/${space.page('Alpha Page').route}`);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.wiki-sidebar')).toBeVisible();
		const publicOrder = await orderIn(page, 'body', names);

		expect(publicOrder).toEqual(adminOrder);
		expect(publicOrder).toEqual(names);
	});

	test('drag and drop reorder should update public view', async ({
		page,
		wiki,
		request,
	}) => {
		const names = ['First', 'Second', 'Third'];
		const reordered = ['Third', 'First', 'Second'];
		const space = await wiki.space({ pages: groupsWithAPageEach(names) });

		await page.goto(space.url());
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=First', { timeout: 10000 });

		await moveToFront(request, space, names, 2);

		await page.reload();
		await page.waitForLoadState('networkidle');
		expect(await orderIn(page, 'aside', names)).toEqual(reordered);

		await page.goto(`/${space.page('Third Page').route}`);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('.wiki-sidebar')).toBeVisible();
		expect(await orderIn(page, 'body', names)).toEqual(reordered);
	});
});
