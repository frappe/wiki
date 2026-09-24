import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, getList } from '../helpers/frappe';
import { saveEditor } from '../helpers/wiki';

/**
 * Opening a space used to open a change request for the viewer, so every visit
 * left a "Draft Changes" entry under My Change Requests with nothing in it.
 * The draft now waits for the first edit.
 */
function changeRequests(request: APIRequestContext, spaceName: string) {
	return getList<{ name: string; status: string }>(
		request,
		'Wiki Change Request',
		{
			fields: ['name', 'status'],
			filters: { wiki_space: spaceName },
			limit: 0,
		},
	);
}

test('opening a space creates no change request until the first edit', async ({
	page,
	request,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Alpha' }] });

	await page.goto(space.url('page', space.page('Alpha').name));
	await page.waitForLoadState('networkidle');
	await expect(
		page.locator('aside').getByText('Alpha', { exact: true }),
	).toBeVisible();
	await expect(page.getByText('Content for Alpha')).toBeVisible();
	expect(await changeRequests(request, space.name)).toHaveLength(0);

	await page.locator('.ProseMirror').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(' edited');
	await saveEditor(page);

	await expect
		.poll(async () => await changeRequests(request, space.name))
		.toEqual([expect.objectContaining({ status: 'Draft' })]);
});

test('typing opens the draft and survives a reload before autosave', async ({
	page,
	request,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Alpha' }] });

	await page.goto(space.url('page', space.page('Alpha').name));
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('Content for Alpha')).toBeVisible();

	await page.locator('.ProseMirror').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(' typed before autosave');

	await expect
		.poll(async () => (await changeRequests(request, space.name)).length)
		.toBe(1);
	// Let the debounced IndexedDB write land, well inside the autosave window.
	await page.waitForTimeout(1000);
	await page.reload();
	await page.waitForLoadState('networkidle');

	await expect(page.locator('.ProseMirror').first()).toContainText(
		'Content for Alpha typed before autosave',
	);
	expect(await changeRequests(request, space.name)).toHaveLength(1);
});

// With no draft left after a merge, the page loads from the published doc.
// It has to be the merged one, not the copy fetched before the merge.
test('merging from a page shows the merged text, not the old one', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({ pages: [{ title: 'Alpha' }] });

	await page.goto(space.url('page', space.page('Alpha').name));
	await page.waitForLoadState('networkidle');
	const editor = page.locator('.ProseMirror').first();
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' merged');
	await saveEditor(page);

	await page.getByRole('button', { name: 'Merge' }).click();
	await expect(page.getByText('Change request merged').first()).toBeVisible();
	await page.waitForLoadState('networkidle');

	await expect(editor).toContainText('Content for Alpha merged');
	await page.reload();
	await expect(page.locator('.ProseMirror').first()).toContainText(
		'Content for Alpha merged',
	);
});

test('two tabs editing at once share one draft', async ({
	page,
	context,
	request,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Alpha' }, { title: 'Beta' }],
	});
	const otherTab = await context.newPage();
	await page.goto(space.url('page', space.page('Alpha').name));
	await otherTab.goto(space.url('page', space.page('Beta').name));
	await expect(page.getByText('Content for Alpha')).toBeVisible();
	await expect(otherTab.getByText('Content for Beta')).toBeVisible();

	const editAndSave = async (tab: typeof page, text: string) => {
		await tab.locator('.ProseMirror').first().click();
		await tab.keyboard.press('End');
		await tab.keyboard.type(text);
		await saveEditor(tab);
	};
	await Promise.all([
		editAndSave(page, ' from tab one'),
		editAndSave(otherTab, ' from tab two'),
	]);

	const drafts = await changeRequests(request, space.name);
	expect(drafts).toHaveLength(1);
	await expect
		.poll(async () => {
			const changes = await callMethod<{ doc_key: string }[]>(
				request,
				'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.diff_change_request',
				{ name: drafts[0].name, scope: 'summary' },
			);
			return changes.length;
		})
		.toBe(2);
});
