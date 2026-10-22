import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createDoc, getList } from '../helpers/frappe';
import {
	editDialog,
	editPage,
	openPageMenuItem,
	startEditing,
} from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

/**
 * Opening a space reads; Edit is the step that starts a change request
 * (specs/edit_flow.md, part 1).
 */

function changeRequestsIn(request: APIRequestContext, space: string) {
	return getList<{ name: string; title: string; status: string }>(
		request,
		'Wiki Change Request',
		{
			fields: ['name', 'title', 'status'],
			filters: { wiki_space: space },
			limit: 0,
		},
	);
}

function recordWrites(page: Page) {
	const writes: string[] = [];
	page.on('request', (request) => {
		const url = request.url();
		if (url.includes(CR_METHOD) || url.includes('apply_cr_operations')) {
			writes.push(url);
		}
	});
	return writes;
}

function editableEditor(page: Page) {
	return page.locator('.ProseMirror[contenteditable="true"]');
}

function header(page: Page) {
	return page.getByRole('main');
}

async function seedContributor(request: APIRequestContext, stamp: string) {
	const email = `e2e-contributor-${stamp}@example.com`;
	const password = `Contributor-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E Contributor',
		new_password: password,
		send_welcome_email: 0,
		roles: [{ role: 'Wiki User' }],
	});
	return { email, password };
}

async function signIn(
	browser: Browser,
	baseURL: string | undefined,
	email: string,
	password: string,
) {
	const context = await browser.newContext({ baseURL });
	const response = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(response.ok()).toBeTruthy();
	return context;
}

test.describe('Explicit edit', () => {
	test('opening a space and a page starts no change request', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
		});
		const writes = recordWrites(page);

		await page.goto(space.url('page', space.page('Alpha').name));
		await expect(page.getByText('Content for Alpha')).toBeVisible({
			timeout: 15000,
		});
		await page.locator('aside').getByText('Beta', { exact: true }).click();
		await expect(page.getByText('Content for Beta')).toBeVisible();

		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible();
		await expect(editableEditor(page)).toHaveCount(0);
		await expect(page.getByText('Draft ·')).toHaveCount(0);
		expect(writes).toEqual([]);
		expect(await changeRequestsIn(request, space.name)).toEqual([]);
	});

	test('Edit names the change, then type, submit and land back in read mode', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		await page.goto(space.url('page', alpha.name));

		await editPage(page, 'Clarify Alpha');
		const editor = editableEditor(page);
		await expect(editor).toBeFocused();
		await expect(page.getByText('Clarify Alpha')).toBeVisible();

		await page.keyboard.type(' Now clearer.');
		await expect(page.getByText('Draft · 1 page changed')).toBeVisible({
			timeout: 15000,
		});

		await header(page)
			.getByRole('button', { name: 'Submit for review' })
			.click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Submit', exact: true })
			.click();
		await expect(page).toHaveURL(/\/change-requests\//);

		const [submitted] = await changeRequestsIn(request, space.name);
		expect(submitted).toMatchObject({
			title: 'Clarify Alpha',
			status: 'In Review',
		});

		await page.goto(space.url('page', alpha.name));
		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(page.getByText('Content for Alpha')).toBeVisible();
		await expect(page.getByText('Now clearer.')).toHaveCount(0);
		expect(await changeRequestsIn(request, space.name)).toHaveLength(1);
	});

	test('cancelling the Edit dialog stays in read mode', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));

		await header(page)
			.getByRole('button', { name: 'Edit', exact: true })
			.click();
		await editDialog(page).getByRole('button', { name: 'Cancel' }).click();
		await expect(editDialog(page)).toBeHidden();

		await expect(editableEditor(page)).toHaveCount(0);
		expect(await changeRequestsIn(request, space.name)).toEqual([]);
	});

	test('Rename in read mode asks for a change request first', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));

		await openPageMenuItem(page, 'Rename');
		await startEditing(page, 'Rename Alpha');

		const rename = page.getByRole('dialog').filter({ hasText: 'Rename Page' });
		await rename.getByLabel('Title').fill('Alpha Renamed');
		await rename.getByRole('button', { name: 'Rename' }).click();

		await expect(
			page.locator('aside').getByText('Alpha Renamed', { exact: true }),
		).toBeVisible();
		const [changeRequest] = await changeRequestsIn(request, space.name);
		expect(changeRequest).toMatchObject({
			title: 'Rename Alpha',
			status: 'Draft',
		});
	});

	test('the read mode tree offers no drag handles', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
		});
		await page.goto(space.url('page', space.page('Alpha').name));
		const rows = page.locator('aside [draggable="true"]');

		await expect(
			page.locator('aside').getByText('Beta', { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(rows).toHaveCount(0);

		await editPage(page, 'Reorder');
		await expect(rows.first()).toBeVisible();
	});

	test('?edit=1 asks for a change request in read mode', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(`${space.url('page', space.page('Alpha').name)}?edit=1`);

		await expect(editDialog(page)).toBeVisible({ timeout: 15000 });
		await expect(page).not.toHaveURL(/edit=1/);
		await startEditing(page, 'From the reader');
		await expect(editableEditor(page)).toBeFocused();
	});

	test('?edit=1 goes straight to the editor when a draft is open', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await wiki.changeRequest(space, 'Already editing');
		await page.goto(`${space.url('page', space.page('Alpha').name)}?edit=1`);

		await expect(editableEditor(page)).toBeFocused({ timeout: 15000 });
		await expect(editDialog(page)).toHaveCount(0);
		await expect(page.getByText('Already editing')).toBeVisible();
	});

	test('a user who can merge merges from the header and lands in read mode', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		await page.goto(space.url('page', alpha.name));

		await editPage(page, 'Quick fix');
		await page.keyboard.type(' Fixed.');
		await header(page).getByRole('button', { name: 'Merge' }).click();
		await expect(page.getByText('Change request merged')).toBeVisible({
			timeout: 15000,
		});

		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible();
		await expect(page.getByText('Content for Alpha Fixed.')).toBeVisible();
		await expect(editableEditor(page)).toHaveCount(0);
		const changeRequests = await changeRequestsIn(request, space.name);
		expect(changeRequests).toEqual([
			expect.objectContaining({ title: 'Quick fix', status: 'Merged' }),
		]);
	});

	test('a contributor who cannot merge sees Submit but not Merge', async ({
		browser,
		request,
		wiki,
	}, info) => {
		const stamp = Date.now().toString(36);
		const { email, password } = await seedContributor(request, stamp);
		const space = await wiki.space({
			roles: [{ role: 'Wiki User', permission_level: 'Read' }],
			pages: [{ title: 'Alpha' }],
		});
		const context = await signIn(
			browser,
			info.project.use.baseURL,
			email,
			password,
		);
		const page = await context.newPage();
		await page.goto(space.url('page', space.page('Alpha').name));

		await editPage(page, 'Contributor edit');
		await page.keyboard.type(' Suggested.');
		await expect(
			header(page).getByRole('button', { name: 'Submit for review' }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			header(page).getByRole('button', { name: 'Merge' }),
		).toHaveCount(0);

		await context.close();
	});

	test('discard leaves edit mode without starting a new change request', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));
		await editPage(page, 'Changed my mind');

		await page.getByRole('button', { name: 'More actions' }).click();
		await page.getByRole('menuitem', { name: 'Discard Changes' }).click();

		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible({ timeout: 15000 });
		const changeRequests = await changeRequestsIn(request, space.name);
		expect(changeRequests).toEqual([
			expect.objectContaining({ status: 'Archived' }),
		]);
	});

	test('submitting a draft with a generated title asks for a real one', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await wiki.changeRequest(space, `Draft Changes - ${space.space_name}`);
		await page.goto(space.url('page', space.page('Alpha').name));

		await expect(editableEditor(page)).toBeVisible({ timeout: 15000 });
		await editableEditor(page).click();
		await page.keyboard.press('End');
		await page.keyboard.type(' Edited.');
		await header(page)
			.getByRole('button', { name: 'Submit for review' })
			.click();

		const dialog = page.getByRole('dialog');
		const submit = dialog.getByRole('button', { name: 'Submit', exact: true });
		await expect(submit).toBeDisabled();
		await dialog.getByLabel('Title').fill('Edit Alpha');
		await submit.click();
		await expect(page).toHaveURL(/\/change-requests\//);

		const [submitted] = await changeRequestsIn(request, space.name);
		expect(submitted).toMatchObject({
			title: 'Edit Alpha',
			status: 'In Review',
		});
	});
});
