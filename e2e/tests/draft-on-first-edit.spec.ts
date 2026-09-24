import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { getList } from '../helpers/frappe';
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
