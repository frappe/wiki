import type { APIRequestContext, Browser } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc, getList } from '../helpers/frappe';
import { appUrl } from '../helpers/routes';
import { expectSyncSettled } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';
const FEEDBACK = 'Please add a second line.';

async function signIn(
	browser: Browser,
	request: APIRequestContext,
	baseURL: string | undefined,
	label: string,
) {
	const stamp = `${label}-${Date.now().toString(36)}`;
	const email = `e2e-${stamp}@example.com`;
	const password = `Feedback-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: `E2E ${label}`,
		new_password: password,
		send_welcome_email: 0,
		roles: [{ role: 'Wiki User' }],
	});
	const context = await browser.newContext({
		baseURL,
		storageState: { cookies: [], origins: [] },
	});
	const response = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(response.ok()).toBeTruthy();
	return context;
}

test('the author reads requested changes on the review page and resubmits', async ({
	browser,
	page,
	request,
	wiki,
}, info) => {
	const baseURL = info.project.use.baseURL;
	const space = await wiki.space({
		allow_contributions: 1,
		roles: [{ role: 'Wiki User', permission_level: 'Read' }],
		pages: [{ title: 'Guide', content: 'First line.' }],
	});
	const author = await signIn(browser, request, baseURL, 'author');
	const other = await signIn(browser, request, baseURL, 'other');

	const post = async (method: string, data: Record<string, unknown>) =>
		author.request.post(`/api/method/${CR_METHOD}.${method}`, { data });
	const created = await post('create_change_request', {
		wiki_space: space.name,
		title: 'Expand the guide',
	});
	const { name } = (await created.json()).message;
	await post('update_cr_page', {
		name,
		doc_key: space.page('Guide').doc_key,
		fields: { content: 'First line, revised.' },
	});
	await post('submit_change_request', { name });
	await callMethod(request, `${CR_METHOD}.request_changes`, {
		name,
		comment: FEEDBACK,
	});

	const refused = await other.request.post(
		`/api/method/${CR_METHOD}.submit_change_request`,
		{ data: { name } },
	);
	expect(refused.status()).toBe(403);

	const reviewUrl = appUrl('spaces', space.name, 'change-requests', name);
	const editButton = { name: 'Edit change request' };

	const otherPage = await other.newPage();
	await otherPage.goto(reviewUrl);
	await expect(otherPage.getByRole('main').getByText(FEEDBACK)).toBeVisible();
	await expect(otherPage.getByRole('button', editButton)).toHaveCount(0);

	await page.goto(reviewUrl);
	await expect(page.getByRole('main').getByText(FEEDBACK)).toBeVisible();
	await expect(page.getByRole('button', editButton)).toHaveCount(0);

	const authorPage = await author.newPage();
	await authorPage.goto(reviewUrl);
	await expect(authorPage.getByRole('main').getByText(FEEDBACK)).toBeVisible();
	await authorPage.getByRole('button', editButton).click();

	const editor = authorPage.locator('.ProseMirror[contenteditable="true"]');
	await expect(editor).toBeFocused({ timeout: 15000 });
	await authorPage.keyboard.press('ControlOrMeta+End');
	await authorPage.keyboard.type(' Second line.');
	await expectSyncSettled(authorPage, 15000);

	await authorPage.getByRole('button', { name: 'Submit for review' }).click();
	await authorPage
		.getByRole('dialog')
		.getByRole('button', { name: 'Submit', exact: true })
		.click();

	await expect(
		authorPage.getByRole('main').getByText('In Review', { exact: true }),
	).toBeVisible({ timeout: 15000 });
	await expect(authorPage.getByRole('main').getByText(FEEDBACK)).toHaveCount(0);
	const [row] = await getList<{ status: string }>(
		request,
		'Wiki Change Request',
		{ filters: { name }, fields: ['status'] },
	);
	expect(row.status).toBe('In Review');

	await authorPage.goto(space.url());
	await authorPage.waitForLoadState('networkidle');
	await expect(
		authorPage.locator('aside').getByText('Guide', { exact: true }),
	).toBeVisible();
	await expect(authorPage.locator('.contribution-strip')).toHaveCount(0);

	await author.close();
	await other.close();
});
