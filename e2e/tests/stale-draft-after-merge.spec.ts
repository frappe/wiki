import { expect, test } from '../fixtures';
import { callMethod, getList } from '../helpers/frappe';
import {
	CHANGE_REQUEST_URL_RE,
	appUrl,
	spaceLinkSelector,
} from '../helpers/routes';
import { saveEditor } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

test('a draft opened during review picks up the merged change', async ({
	page,
	request,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [
			{ title: 'Alpha', content: 'alpha original' },
			{ title: 'Beta', content: 'beta original' },
		],
	});
	const editor = page.locator('.ProseMirror').first();

	await page.goto(space.url('page', space.page('Alpha').name));
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(' alpha edited');
	await saveEditor(page);
	await page.getByRole('button', { name: 'Submit for review' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Submit', exact: true })
		.click();
	await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE);
	const inReview = decodeURIComponent(page.url().split('/').pop() as string);

	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await expect(editor).toHaveText('alpha original');

	await page.locator('aside').getByText('Beta', { exact: true }).click();
	await expect(editor).toHaveText('beta original');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(' beta edited');
	const saved = page.waitForResponse(/apply_cr_operations/);
	await saveEditor(page);
	await saved;

	const reviewer = await page.context().newPage();
	await reviewer.goto(appUrl('change-requests', inReview));
	await reviewer.getByRole('button', { name: 'Approve', exact: true }).click();
	await reviewer.getByRole('button', { name: 'Merge', exact: true }).click();
	await expect(
		reviewer.getByText('Change request merged').first(),
	).toBeVisible();
	await reviewer.close();

	// Re-enter without a reload so the SPA keeps Alpha's old buffer.
	await page.getByRole('link', { name: 'Back to All Spaces' }).click();
	await page.locator(spaceLinkSelector(space.name)).first().click();
	await page.locator('aside').getByText('Alpha', { exact: true }).click();
	await expect(editor).toHaveText('alpha original alpha edited');
	await page.locator('aside').getByText('Beta', { exact: true }).click();
	await expect(editor).toHaveText('beta original beta edited');

	await page.reload();
	await page.locator('aside').getByText('Alpha', { exact: true }).click();
	await expect(editor).toHaveText('alpha original alpha edited');

	const drafts = await getList<{ name: string }>(
		request,
		'Wiki Change Request',
		{ filters: { wiki_space: space.name, status: 'Draft' } },
	);
	expect(drafts).toHaveLength(1);
	const changes = await callMethod<{ doc_key: string }[]>(
		request,
		`${CR_METHOD}.diff_change_request`,
		{ name: drafts[0].name },
	);
	expect(changes.map((change) => change.doc_key)).toEqual([
		space.page('Beta').doc_key,
	]);
});

test('the review page shows conflicts left by a merge started elsewhere', async ({
	page,
	request,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Alpha', content: 'alpha original' }],
	});
	const docKey = space.page('Alpha').doc_key;
	const draftWith = async (content: string) => {
		const cr = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD}.create_change_request`,
			{ wiki_space: space.name, title: content },
		);
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: cr.name,
			doc_key: docKey,
			fields: { content },
		});
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: cr.name,
		});
		await callMethod(request, `${CR_METHOD}.approve_change_request`, {
			name: cr.name,
		});
		return cr.name;
	};
	const first = await draftWith('first edit');
	const second = await draftWith('second edit');
	await callMethod(request, `${CR_METHOD}.merge_change_request`, {
		name: first,
	});
	await expect(
		callMethod(request, `${CR_METHOD}.merge_change_request`, { name: second }),
	).rejects.toThrow();

	await page.goto(appUrl('change-requests', second));
	await expect(page.getByText('Merge Conflicts')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Resolve & Merge' }),
	).toBeVisible();
});
