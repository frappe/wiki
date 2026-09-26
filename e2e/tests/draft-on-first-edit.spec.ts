import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, getList } from '../helpers/frappe';
import { saveEditor } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

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

// The page panel starts hydrating before the space store's watcher runs. The
// watcher used to reset the store under it, so the workspace was fetched twice.
test('opening a page fetches the workspace once', async ({ page, wiki }) => {
	const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
	let fetches = 0;
	page.on('request', (request) => {
		if (request.url().includes('get_draft_workspace')) fetches += 1;
	});

	await page.goto(space.url('page', space.page('Alpha').name));
	await expect(page.getByText('Content for Alpha')).toBeVisible();
	await page.waitForLoadState('networkidle');

	expect(fetches).toBe(1);
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
				`${CR_METHOD}.diff_change_request`,
				{ name: drafts[0].name, scope: 'summary' },
			);
			return changes.length;
		})
		.toBe(2);
});

// The page was loaded before another change to it merged. The draft opened by
// the first edit starts where the page was loaded, so the merge reports the
// conflict instead of saving the old text over main.
for (const reloadBeforeSave of [false, true]) {
	test(`typing on a page main changed since it loaded conflicts at merge${
		reloadBeforeSave ? ', after a reload' : ''
	}`, async ({ page, request, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha', content: 'line one' }],
		});
		const alpha = space.page('Alpha');
		const editor = page.locator('.ProseMirror').first();
		await page.goto(space.url('page', alpha.name));
		await expect(editor).toHaveText('line one');

		const other = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD}.create_change_request`,
			{ wiki_space: space.name, title: 'Other author' },
		);
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: other.name,
			doc_key: alpha.doc_key,
			fields: { content: 'line one\n\nmerged elsewhere' },
		});
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: other.name,
		});
		await callMethod(request, `${CR_METHOD}.approve_change_request`, {
			name: other.name,
		});
		await callMethod(request, `${CR_METHOD}.merge_change_request`, {
			name: other.name,
		});

		await editor.click();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(' mine');
		if (reloadBeforeSave) {
			await expect
				.poll(async () => (await changeRequests(request, space.name)).length)
				.toBe(2);
			// Let the debounced IndexedDB write land, inside the autosave window.
			await page.waitForTimeout(1000);
			await page.reload();
			await expect(editor).toContainText('mine');
		}
		const saved = page.waitForResponse(/apply_cr_operations/);
		await saveEditor(page);
		await saved;

		const [draft] = (await changeRequests(request, space.name)).filter(
			(cr) => cr.status === 'Draft',
		);
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: draft.name,
		});
		await callMethod(request, `${CR_METHOD}.approve_change_request`, {
			name: draft.name,
		});
		const merge = await callMethod(
			request,
			`${CR_METHOD}.merge_change_request`,
			{ name: draft.name },
		).then(
			() => 'merged',
			() => 'conflict',
		);
		expect(merge).toBe('conflict');
		const live = await getList<{ content: string }>(request, 'Wiki Document', {
			fields: ['content'],
			filters: { name: alpha.name },
		});
		expect(live[0].content).toContain('merged elsewhere');
	});
}
