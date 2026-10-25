import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc, getList } from '../helpers/frappe';
import { appUrl } from '../helpers/routes';
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

interface TiptapEditor {
	state: {
		doc: {
			content: { size: number };
			textBetween(from: number, to: number): string;
		};
		selection: { from: number };
	};
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

	test('the editor takes focus with the caret at the end of the page', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		// Text after the caret when the editor first takes focus. The editor
		// often mounts before the Edit dialog has finished closing.
		await page.addInitScript(() => {
			document.addEventListener(
				'focusin',
				(event) => {
					const editor = (event.target as { editor?: TiptapEditor }).editor;
					if (!editor || 'textAfterCaret' in window) return;
					const { doc, selection } = editor.state;
					Object.assign(window, {
						textAfterCaret: doc.textBetween(selection.from, doc.content.size),
					});
				},
				true,
			);
		});
		await page.goto(space.url('page', space.page('Alpha').name));

		await editPage(page, 'Typed early');
		await page.keyboard.type(' Early.');

		await expect(editableEditor(page)).toContainText(
			'Content for Alpha Early.',
		);
		expect(
			await page.evaluate(
				() => (window as { textAfterCaret?: string }).textAfterCaret,
			),
		).toBe('');
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

async function changeRequestInReview(
	request: APIRequestContext,
	cr: { name: string },
	docKey: string,
	content: string,
) {
	await callMethod(request, `${CR_METHOD}.update_cr_page`, {
		name: cr.name,
		doc_key: docKey,
		fields: { content },
	});
	await callMethod(request, `${CR_METHOD}.submit_change_request`, {
		name: cr.name,
	});
}

async function crPageContent(
	request: APIRequestContext,
	cr: { name: string },
	docKey: string,
) {
	const page = await callMethod<{ content: string }>(
		request,
		`${CR_METHOD}.get_cr_page`,
		{ name: cr.name, doc_key: docKey },
	);
	return page.content;
}

async function typeAtEnd(page: Page, text: string) {
	const editor = editableEditor(page);
	await expect(editor).toBeVisible({ timeout: 15000 });
	await editor.click();
	await page.keyboard.press('Control+End');
	await page.keyboard.type(text);
}

test.describe('Editing a change request in review', () => {
	test('a reviewer edits it in place, across a reload, and is done', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		const cr = await wiki.changeRequest(space, 'Polish Alpha');
		await changeRequestInReview(
			request,
			cr,
			alpha.doc_key,
			'Content for Alpha Proposed.',
		);

		await page.goto(appUrl('change-requests', cr.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();

		await expect(page).toHaveURL(new RegExp(`/page/${alpha.name}`));
		await expect(page.getByText('In review · 1 page changed')).toBeVisible({
			timeout: 15000,
		});
		await typeAtEnd(page, ' Reviewed.');
		await expect
			.poll(() => crPageContent(request, cr, alpha.doc_key), {
				timeout: 15000,
			})
			.toContain('Proposed. Reviewed.');

		await page.reload();
		await expect(editableEditor(page)).toContainText('Proposed. Reviewed.', {
			timeout: 15000,
		});
		await page.getByRole('button', { name: 'More actions' }).first().click();
		await expect(
			page.getByRole('menuitem', { name: 'Discard Changes' }),
		).toHaveCount(0);
		await page.keyboard.press('Escape');

		await header(page).getByRole('button', { name: 'Done editing' }).click();
		await expect(page).toHaveURL(new RegExp(`/change-requests/${cr.name}`));
		expect(await changeRequestsIn(request, space.name)).toEqual([
			expect.objectContaining({ name: cr.name, status: 'In Review' }),
		]);

		await page.goto(space.url('page', alpha.name));
		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(editableEditor(page)).toHaveCount(0);
	});

	test('editing it after your own draft in the space shows its text, not yours', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		const cr = await wiki.changeRequest(space, 'Review Alpha');
		await changeRequestInReview(
			request,
			cr,
			alpha.doc_key,
			'Content for Alpha Theirs.',
		);

		await page.goto(space.url('page', alpha.name));
		await editPage(page, 'My own draft');
		await typeAtEnd(page, ' Mine.');
		await expect(page.getByText('Draft · 1 page changed')).toBeVisible({
			timeout: 15000,
		});

		await page.getByRole('link', { name: 'Back to All Spaces' }).click();
		await page.getByRole('link', { name: 'Change Requests' }).click();
		await page.getByText('Review Alpha').click();
		await expect(page).toHaveURL(new RegExp(`/change-requests/${cr.name}`));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();

		await expect(page.getByText('In review · 1 page changed')).toBeVisible({
			timeout: 15000,
		});
		const editor = editableEditor(page);
		await expect(editor).toContainText('Theirs.', { timeout: 15000 });
		await expect(editor).not.toContainText('Mine.');
		await typeAtEnd(page, ' Reviewed.');
		await expect
			.poll(() => crPageContent(request, cr, alpha.doc_key), {
				timeout: 15000,
			})
			.toContain('Theirs. Reviewed.');
		expect(await crPageContent(request, cr, alpha.doc_key)).not.toContain(
			'Mine.',
		);
	});

	test('a page it adds offers Done editing', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const cr = await wiki.changeRequest(space, 'Add Beta');
		const tree = await callMethod<{ root_group: string }>(
			request,
			`${CR_METHOD}.get_cr_tree`,
			{ name: cr.name },
		);
		await callMethod(request, `${CR_METHOD}.create_cr_page`, {
			name: cr.name,
			parent_key: tree.root_group,
			title: 'Beta',
			content: 'Content for Beta.',
		});
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: cr.name,
		});

		await page.goto(appUrl('change-requests', cr.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page).toHaveURL(/\/draft\//);
		await expect(editableEditor(page)).toContainText('Content for Beta.', {
			timeout: 15000,
		});

		await header(page).getByRole('button', { name: 'Done editing' }).click();
		await expect(page).toHaveURL(new RegExp(`/change-requests/${cr.name}`));
	});

	test('an edit sends an approved change request back to review', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		const cr = await wiki.changeRequest(space, 'Approve Alpha');
		await changeRequestInReview(
			request,
			cr,
			alpha.doc_key,
			'Content for Alpha Approved.',
		);
		await callMethod(request, `${CR_METHOD}.approve_change_request`, {
			name: cr.name,
		});

		await page.goto(appUrl('change-requests', cr.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByText('Approved · 1 page changed')).toBeVisible({
			timeout: 15000,
		});
		await typeAtEnd(page, ' Then changed.');

		await expect(page.getByText('In review · 1 page changed')).toBeVisible({
			timeout: 15000,
		});
		expect(await changeRequestsIn(request, space.name)).toEqual([
			expect.objectContaining({ name: cr.name, status: 'In Review' }),
		]);
	});

	test('an author who cannot merge edits it but sees no Merge', async ({
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
		const alpha = space.page('Alpha');
		const context = await signIn(
			browser,
			info.project.use.baseURL,
			email,
			password,
		);
		const authored = await callMethod<{ name: string }>(
			context.request,
			`${CR_METHOD}.create_change_request`,
			{ wiki_space: space.name, title: 'Suggest Alpha' },
		);
		await changeRequestInReview(
			context.request,
			authored,
			alpha.doc_key,
			'Content for Alpha Suggested.',
		);
		const page = await context.newPage();

		await page.goto(appUrl('change-requests', authored.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await typeAtEnd(page, ' More.');

		await expect(
			header(page).getByRole('button', { name: 'Done editing' }),
		).toBeVisible();
		await expect(
			header(page).getByRole('button', { name: 'Merge' }),
		).toHaveCount(0);
		await expect
			.poll(() => crPageContent(request, authored, alpha.doc_key), {
				timeout: 15000,
			})
			.toContain('Suggested. More.');

		await context.close();
	});
});
