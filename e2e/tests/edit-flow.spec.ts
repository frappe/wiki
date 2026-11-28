import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc, getList } from '../helpers/frappe';
import { editPage, newPageButton, openTreeRowMenuItem } from '../helpers/wiki';

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
		if (request.method() === 'GET') return;
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
		// mounts as soon as the draft hydrates, before Edit has finished.
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

		await editPage(page);
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

	test('Edit starts a placeholder change request, Submit names it', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const alpha = space.page('Alpha');
		const placeholder = `Edit Alpha in ${space.space_name}`;
		await page.goto(space.url('page', alpha.name));

		await editPage(page);
		const editor = editableEditor(page);
		await expect(editor).toBeFocused();
		await expect(page.getByText(placeholder)).toBeVisible();

		await page.keyboard.type(' Now clearer.');
		await expect(page.getByText('Draft · 1 page changed')).toBeVisible({
			timeout: 15000,
		});

		await header(page)
			.getByRole('button', { name: 'Submit for review' })
			.click();
		const dialog = page.getByRole('dialog');
		const title = dialog.getByLabel('Title');
		const submit = dialog.getByRole('button', { name: 'Submit', exact: true });
		await expect(title).toHaveValue(placeholder);
		await title.fill('');
		await expect(submit).toBeDisabled();
		await title.fill('Clarify Alpha');
		await dialog.getByLabel('Description').fill('The intro was vague.');
		await submit.click();
		await expect(page).toHaveURL(/\/change-requests\//);

		const [submitted] = await changeRequestsIn(request, space.name);
		expect(submitted).toMatchObject({
			title: 'Clarify Alpha',
			status: 'In Review',
		});
		const { description } = await callMethod<{ description: string }>(
			request,
			'frappe.client.get',
			{ doctype: 'Wiki Change Request', name: submitted.name },
		);
		expect(description).toBe('The intro was vague.');

		await page.goto(space.url('page', alpha.name));
		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(page.getByText('Content for Alpha')).toBeVisible();
		await expect(page.getByText('Now clearer.')).toHaveCount(0);
		expect(await changeRequestsIn(request, space.name)).toHaveLength(1);
	});

	test('Submit saves fresh typing before it counts the changes', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));
		await editPage(page);

		let releaseSave = () => {};
		const saveHeld = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		await page.route(/apply_cr_operations/, async (route) => {
			await saveHeld;
			await route.continue();
		});

		await page.keyboard.type(' Quick words.');
		await header(page)
			.getByRole('button', { name: 'Submit for review' })
			.click();

		const dialog = page.getByRole('dialog');
		const submit = dialog.getByRole('button', { name: 'Submit', exact: true });
		await expect(dialog.getByText('Saving your changes...')).toBeVisible();
		await expect(submit).toBeDisabled();

		releaseSave();
		await expect(
			dialog.getByText('1 pending change will be sent for review.'),
		).toBeVisible();
		await expect(submit).toBeEnabled();
	});

	test('row actions show only in edit mode', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));

		const aside = page.locator('aside');
		await expect(aside.getByText('Alpha', { exact: true })).toBeVisible({
			timeout: 15000,
		});
		await expect(
			aside.locator('[role="treeitem"] .lucide-more-horizontal'),
		).toHaveCount(0);

		await editPage(page);
		await openTreeRowMenuItem(page, 'Alpha', 'Change Title');
		const rename = page.getByRole('dialog').filter({ hasText: 'Change Title' });
		await rename.getByLabel('Title').fill('Alpha Renamed');
		await rename.getByRole('button', { name: 'Save' }).click();

		await expect(
			aside.getByText('Alpha Renamed', { exact: true }),
		).toBeVisible();
		const [changeRequest] = await changeRequestsIn(request, space.name);
		expect(changeRequest).toMatchObject({
			title: `Edit Alpha in ${space.space_name}`,
			status: 'Draft',
		});
	});

	test('New page in read mode starts a change request on Save, not on open', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));
		const edit = header(page).getByRole('button', {
			name: 'Edit',
			exact: true,
		});
		const create = page
			.getByRole('dialog')
			.filter({ hasText: 'Create New Page' });

		await expect(edit).toBeVisible({ timeout: 15000 });
		await newPageButton(page).click();
		await expect(create).toBeVisible();
		await create.getByRole('button', { name: 'Cancel' }).click();
		await expect(create).toBeHidden();
		await expect(edit).toBeVisible();
		expect(await changeRequestsIn(request, space.name)).toHaveLength(0);

		await newPageButton(page).click();
		await create.getByLabel('Title').fill('Gamma');
		await create.getByRole('button', { name: 'Save' }).click();

		await page.waitForURL(/\/draft\//, { timeout: 15000 });
		await expect(
			page.locator('aside').getByText('Gamma', { exact: true }),
		).toBeVisible();
		const [changeRequest] = await changeRequestsIn(request, space.name);
		expect(changeRequest).toMatchObject({
			title: `New page in ${space.space_name}`,
			status: 'Draft',
		});
	});

	test('dragging a page in read mode starts a change request that submit names', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
		});
		const placeholder = `Reorder pages in ${space.space_name}`;
		await page.goto(space.url('page', space.page('Alpha').name));
		const rows = page.locator('aside [draggable="true"]');
		const row = (title: string) => rows.filter({ hasText: title });
		const dropBefore = (source: string, target: string) =>
			row(source).dragTo(row(target), { targetPosition: { x: 40, y: 2 } });

		await expect(rows).toHaveText(['Alpha', 'Beta', 'Gamma'], {
			timeout: 15000,
		});

		await dropBefore('Alpha', 'Beta');
		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible();
		expect(await changeRequestsIn(request, space.name)).toHaveLength(0);

		const moveSaved = page.waitForResponse(
			(response) =>
				response.url().includes('apply_cr_operations') && response.ok(),
		);
		await dropBefore('Gamma', 'Alpha');
		await expect(rows).toHaveText(['Gamma', 'Alpha', 'Beta']);
		await expect(page.getByText(placeholder)).toBeVisible({ timeout: 15000 });
		await moveSaved;

		await page.reload();
		await expect(rows).toHaveText(['Gamma', 'Alpha', 'Beta'], {
			timeout: 15000,
		});

		await header(page)
			.getByRole('button', { name: 'Submit for review' })
			.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByLabel('Title')).toHaveValue(placeholder);
		await dialog.getByLabel('Title').fill('Put Gamma first');
		await dialog.getByLabel('Description').fill('Gamma is read most.');
		await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page).toHaveURL(/\/change-requests\//);

		const [submitted] = await changeRequestsIn(request, space.name);
		expect(submitted).toMatchObject({
			title: 'Put Gamma first',
			status: 'In Review',
		});
		const { description } = await callMethod<{ description: string }>(
			request,
			'frappe.client.get',
			{ doctype: 'Wiki Change Request', name: submitted.name },
		);
		expect(description).toBe('Gamma is read most.');
	});

	test('a drop that cannot start a change request puts the page back', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
		});
		await page.route('**/*get_or_create_draft_change_request*', (route) =>
			route.fulfill({ status: 500, json: {} }),
		);
		await page.goto(space.url('page', space.page('Alpha').name));
		const rows = page.locator('aside [draggable="true"]');
		await expect(rows).toHaveText(['Alpha', 'Beta'], { timeout: 15000 });

		const failed = page.waitForResponse((response) =>
			response.url().includes('get_or_create_draft_change_request'),
		);
		await rows
			.filter({ hasText: 'Beta' })
			.dragTo(rows.filter({ hasText: 'Alpha' }), {
				targetPosition: { x: 40, y: 2 },
			});
		await failed;

		await expect(rows).toHaveText(['Alpha', 'Beta']);
		await expect(
			page.getByRole('region', { name: /Notifications/ }).getByRole('listitem'),
		).toBeVisible();
		expect(await changeRequestsIn(request, space.name)).toHaveLength(0);
	});

	test('?edit=1 starts a change request in read mode', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(`${space.url('page', space.page('Alpha').name)}?edit=1`);

		await expect(editableEditor(page)).toBeFocused({ timeout: 15000 });
		await expect(page).not.toHaveURL(/edit=1/);
		const [changeRequest] = await changeRequestsIn(request, space.name);
		expect(changeRequest.title).toBe(`Edit Alpha in ${space.space_name}`);
	});

	test('?edit=1 goes straight to the editor when a draft is open', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await wiki.changeRequest(space, 'Already editing');
		await page.goto(`${space.url('page', space.page('Alpha').name)}?edit=1`);

		await expect(editableEditor(page)).toBeFocused({ timeout: 15000 });
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

		await editPage(page);
		await page.keyboard.type(' Fixed.');
		await header(page)
			.getByRole('button', { name: 'Merge', exact: true })
			.click();
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
			expect.objectContaining({
				title: `Edit Alpha in ${space.space_name}`,
				status: 'Merged',
			}),
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

		await editPage(page);
		await page.keyboard.type(' Suggested.');
		await expect(
			header(page).getByRole('button', { name: 'Submit for review' }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			header(page).getByRole('button', { name: 'Merge', exact: true }),
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
		await editPage(page);

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

		await page.goto(space.url('change-requests', cr.name));
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

		await header(page)
			.getByRole('button', { name: 'Save', exact: true })
			.click();
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

	test('merging it from its review leaves no change marks on the tree', async ({
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
		const alphaRow = page.locator('aside [role="treeitem"]', {
			hasText: 'Alpha',
		});

		await page.goto(space.url('change-requests', cr.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(alphaRow.getByLabel('Modified', { exact: true })).toBeVisible({
			timeout: 15000,
		});

		await header(page)
			.getByRole('button', { name: /open on this page/ })
			.click();
		await page.getByRole('link', { name: /Polish Alpha/ }).click();
		await expect(page).toHaveURL(new RegExp(`/change-requests/${cr.name}`));
		await header(page)
			.getByRole('button', { name: 'Approve', exact: true })
			.click();
		await header(page)
			.getByRole('button', { name: 'Merge', exact: true })
			.click();
		await expect(page.getByText('Change request merged')).toBeVisible();

		await alphaRow.click();
		await expect(
			header(page).getByRole('button', { name: 'Edit', exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(alphaRow.getByLabel('Modified', { exact: true })).toHaveCount(
			0,
		);
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
		await editPage(page);
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

	test('a page it adds offers Save', async ({ page, request, wiki }) => {
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

		await page.goto(space.url('change-requests', cr.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page).toHaveURL(/\/draft\//);
		await expect(editableEditor(page)).toContainText('Content for Beta.', {
			timeout: 15000,
		});

		await header(page)
			.getByRole('button', { name: 'Save', exact: true })
			.click();
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

		await page.goto(space.url('change-requests', cr.name));
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

		await page.goto(space.url('change-requests', authored.name));
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await typeAtEnd(page, ' More.');

		await expect(
			header(page).getByRole('button', { name: 'Save', exact: true }),
		).toBeVisible();
		await expect(
			header(page).getByRole('button', { name: 'Merge', exact: true }),
		).toHaveCount(0);
		await expect
			.poll(() => crPageContent(request, authored, alpha.doc_key), {
				timeout: 15000,
			})
			.toContain('Suggested. More.');

		await context.close();
	});
});
