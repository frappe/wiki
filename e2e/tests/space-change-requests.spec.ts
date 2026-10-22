import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc, deleteDoc } from '../helpers/frappe';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

/**
 * The space's open change requests, in the page header panel and as a notice
 * on the pages they change (specs/edit_flow.md, part 3).
 */

async function changeRequestEditing(
	request: APIRequestContext,
	space: { name: string },
	page: { doc_key?: string },
	title: string,
) {
	const changeRequest = await callMethod<{ name: string }>(
		request,
		`${CR_METHOD}.create_change_request`,
		{ wiki_space: space.name, title },
	);
	await callMethod(request, `${CR_METHOD}.update_cr_page`, {
		name: changeRequest.name,
		doc_key: page.doc_key,
		fields: { content: `${title}.` },
	});
	return changeRequest;
}

async function submittedChangeRequest(
	request: APIRequestContext,
	space: { name: string },
	page: { doc_key?: string },
	title: string,
) {
	const changeRequest = await changeRequestEditing(request, space, page, title);
	await callMethod(request, `${CR_METHOD}.submit_change_request`, {
		name: changeRequest.name,
	});
	return changeRequest;
}

test.describe('Change requests in the space', () => {
	test("a contributor sees others' submitted change requests, not their drafts", async ({
		browser,
		request,
		wiki,
	}, info) => {
		const stamp = Date.now().toString(36);
		const email = `e2e-cr-reader-${stamp}@example.com`;
		const password = `Reader-${stamp}!`;
		await createDoc(request, 'User', {
			email,
			first_name: 'E2E Reader',
			new_password: password,
			send_welcome_email: 0,
			roles: [{ role: 'Wiki User' }],
		});
		const space = await wiki.space({
			roles: [{ role: 'Wiki User', permission_level: 'Read' }],
			pages: [{ title: 'Alpha' }, { title: 'Beta' }],
		});
		const alpha = space.page('Alpha');
		await submittedChangeRequest(request, space, alpha, 'Fix Alpha');
		await submittedChangeRequest(
			request,
			space,
			space.page('Beta'),
			'Rewrite Beta',
		);
		await changeRequestEditing(request, space, alpha, 'Unfinished Alpha');

		const context = await browser.newContext({
			baseURL: info.project.use.baseURL,
		});
		try {
			await context.request.post('/api/method/login', {
				form: { usr: email, pwd: password },
			});
			const page = await context.newPage();
			await page.goto(space.url('page', alpha.name));

			const notice = page.getByTestId('page-change-requests-notice');
			await expect(notice).toContainText(
				'1 open change request changes this page',
			);
			await notice.getByRole('button', { name: 'View' }).click();
			await expect(page.getByRole('menuitem')).toHaveText(['Fix Alpha']);
			await page.keyboard.press('Escape');

			await page
				.getByRole('button', { name: '2 open change requests' })
				.click();
			const panel = page.getByTestId('change-requests-panel');
			const thisPage = panel.getByRole('region', {
				name: 'Changing this page',
			});
			const elsewhere = panel.getByRole('region', {
				name: 'Elsewhere in this space',
			});
			await expect(thisPage.getByRole('link')).toHaveCount(1);
			await expect(thisPage.getByRole('link')).toContainText('Fix Alpha');
			await expect(thisPage.getByRole('link')).toContainText('In Review');
			await expect(elsewhere.getByRole('link')).toHaveCount(1);
			await expect(elsewhere.getByRole('link')).toContainText('Rewrite Beta');
			await expect(panel).not.toContainText('Unfinished Alpha');
			await expect(notice).toHaveCount(0);

			await thisPage.getByRole('link').click();
			await expect(
				page.getByRole('heading', { name: 'Fix Alpha', level: 1 }),
			).toBeVisible();
		} finally {
			await context.close();
			await deleteDoc(request, 'User', email).catch(() => {});
		}
	});

	test('the change requests panel and page settings share the right slot', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));

		const changeRequestsButton = page.getByRole('button', {
			name: '0 open change requests',
		});
		await changeRequestsButton.click();
		const panel = page.getByTestId('change-requests-panel');
		await expect(panel).toContainText('No open change requests');

		await page
			.getByRole('button', { name: 'Page settings', exact: true })
			.click();
		await expect(page.getByTestId('page-settings-panel')).toBeVisible();
		await expect(page.getByTestId('page-settings-panel')).not.toContainText(
			'From the repo',
		);
		await expect(panel).toHaveCount(0);

		await changeRequestsButton.click();
		await expect(panel).toBeVisible();
		await expect(page.getByTestId('page-settings-panel')).toHaveCount(0);

		await panel.getByRole('button', { name: 'Close change requests' }).click();
		await expect(panel).toHaveCount(0);
	});

	test('on a phone the side panel covers the page', async ({ page, wiki }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));

		await page.getByRole('button', { name: '0 open change requests' }).click();
		const box = await page.getByTestId('change-requests-panel').boundingBox();
		expect(box?.width).toBe(390);
	});
});
