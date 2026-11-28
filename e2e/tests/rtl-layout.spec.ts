import type { APIRequestContext, Browser, Locator } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc } from '../helpers/frappe';

/**
 * Right-to-left layout (#848).
 *
 * The request language sets `<html lang dir>` on the public reader and the
 * app. An Arabic reader gets a mirrored page whose code still reads left to
 * right; an English one keeps the left-to-right layout.
 */
const CONTENT = 'مرحبا بكم في الويكي.\n\n```python\nprint("hello")\n```\n';
// browser.newContext() inherits the project's signed-in storageState.
const SIGNED_OUT = { cookies: [], origins: [] };

async function signInAsArabicUser(
	browser: Browser,
	request: APIRequestContext,
	baseURL?: string,
) {
	const stamp = Date.now();
	const email = `e2e-rtl-${stamp}@example.com`;
	const password = `Rtl-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E RTL',
		language: 'ar',
		new_password: password,
		send_welcome_email: 0,
		roles: [{ role: 'Wiki User' }],
	});
	const context = await browser.newContext({
		baseURL,
		storageState: SIGNED_OUT,
	});
	const response = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(response.ok()).toBeTruthy();
	return context;
}

/** Where each word starts on screen, so a test can see the order a reader sees. */
async function wordLefts(locator: Locator, words: string[]) {
	return locator.evaluate((element, wanted) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const lefts: Record<string, number> = {};
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			for (const word of wanted) {
				const start = node.textContent?.indexOf(word) ?? -1;
				if (start < 0 || word in lefts) continue;
				const range = document.createRange();
				range.setStart(node, start);
				range.setEnd(node, start + word.length);
				lefts[word] = range.getBoundingClientRect().left;
			}
		}
		return wanted.map((word) => lefts[word]);
	}, words);
}

async function expectReadsLeftToRight(
	locator: Locator,
	first: string,
	second: string,
) {
	await expect(locator).toContainText(second);
	const [firstLeft, secondLeft] = await wordLefts(locator, [first, second]);
	expect(firstLeft, `"${first}" comes before "${second}"`).toBeLessThan(
		secondLeft,
	);
}

test('an Arabic user reads English names with numbers in their written order', async ({
	browser,
	baseURL,
	request,
	wiki,
}) => {
	const stamp = Date.now().toString(36);
	const spaceName = `12 Guides ${stamp}`;
	const space = await wiki.space({
		space_name: spaceName,
		pages: [
			{ title: '3 Steps', content: 'Short page.' },
			{ title: 'دليل المستخدم', content: 'مرحبا' },
			{
				title: '2 Parts',
				is_group: true,
				children: [{ title: '4 Notes', content: 'Short page.' }],
			},
		],
	});
	const crMethod =
		'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';
	const changeRequest = await wiki.changeRequest(space, '5 Fixes');
	await callMethod(request, `${crMethod}.update_cr_page`, {
		name: changeRequest.name,
		doc_key: space.page('3 Steps').doc_key,
		fields: { content: 'Changed page.' },
	});
	await callMethod(request, `${crMethod}.submit_change_request`, {
		name: changeRequest.name,
	});

	const context = await signInAsArabicUser(browser, request, baseURL);
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });

	await page.goto('/wiki-app/spaces');
	const card = page
		.locator(`a[href="${space.url()}"]`)
		.filter({ has: page.locator('.font-mono') });
	await expectReadsLeftToRight(card, '12', 'Guides');
	const pageCount = (
		await card.locator('.font-mono').first().innerText()
	).trim();
	await expectReadsLeftToRight(card, pageCount, 'pages');

	await page.goto(space.url('page', space.page('4 Notes').name));
	const tree = page.locator('aside [role="treeitem"]');
	const treeRow = tree.filter({ hasText: '3 Steps' });
	await expectReadsLeftToRight(treeRow, '3', 'Steps');
	await expectReadsLeftToRight(
		page.getByRole('main').getByRole('link', { name: '2 Parts' }),
		'2',
		'Parts',
	);
	await expectReadsLeftToRight(
		page.getByTestId('page-meta-line'),
		'1',
		'min read',
	);
	const title = page.getByPlaceholder('Page title');
	await expect(title).toHaveValue('4 Notes');
	await expect(title).toHaveCSS('unicode-bidi', 'plaintext');
	await expect(title).toHaveCSS('text-align', 'right');

	// Arabic still runs right to left, and English stays on the mirrored edge.
	const arabicRow = tree.filter({ hasText: 'دليل المستخدم' });
	const [firstWord, secondWord] = await wordLefts(arabicRow, [
		'دليل',
		'المستخدم',
	]);
	expect(firstWord).toBeGreaterThan(secondWord);
	const rowBox = await treeRow.boundingBox();
	const [stepsLeft] = await wordLefts(treeRow, ['Steps']);
	expect(rowBox && stepsLeft > rowBox.x + rowBox.width / 2).toBe(true);

	await page.getByRole('button', { name: /open on this page/ }).click();
	await expectReadsLeftToRight(
		page.getByTestId('change-requests-panel').getByRole('link', {
			name: /5 Fixes/,
		}),
		'5',
		'Fixes',
	);

	await page.goto(space.url('change-requests', changeRequest.name));
	await expectReadsLeftToRight(
		page.getByRole('heading', { level: 1, name: '5 Fixes' }),
		'5',
		'Fixes',
	);
	await context.close();
});

test('an Arabic guest reads a right-to-left page', async ({
	browser,
	baseURL,
	wiki,
}) => {
	const space = await wiki.space({
		roles: [{ role: 'Guest', permission_level: 'Read' }],
		pages: [{ title: 'Start', content: CONTENT }],
	});
	const context = await browser.newContext({
		baseURL,
		locale: 'ar',
		storageState: SIGNED_OUT,
	});
	const page = await context.newPage();
	await page.setViewportSize({ width: 1280, height: 900 });

	await page.goto(`/${space.page('Start').route}`);

	await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('.wiki-rendered pre')).toHaveCSS(
		'direction',
		'ltr',
	);
	const sidebar = await page.locator('.wiki-sidebar').boundingBox();
	const content = await page.locator('.wiki-rendered').boundingBox();
	// The sidebar sits on the right of the content.
	expect(sidebar && content && sidebar.x > content.x).toBe(true);
	// The toggle's hover strip spans the full height, so on the wrong side it covers page actions.
	const toggle = await page.locator('.wiki-sidebar-toggle').boundingBox();
	expect(toggle && sidebar && toggle.x + toggle.width > sidebar.x).toBe(true);
	await context.close();
});

test('an Arabic user edits in a right-to-left app', async ({
	browser,
	baseURL,
	request,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Start', content: CONTENT }],
	});
	const context = await signInAsArabicUser(browser, request, baseURL);
	const page = await context.newPage();
	await page.setViewportSize({ width: 1280, height: 900 });

	await page.goto(space.url('page', space.page('Start').name));

	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	const content = page.locator('.wiki-rendered').first();
	await expect(content).toContainText('مرحبا');
	// reka-ui's ScrollArea wraps the editor and defaults to ltr without a ConfigProvider.
	await expect(content).toHaveCSS('direction', 'rtl');
	await expect(content.locator('pre')).toHaveCSS('direction', 'ltr');
	await context.close();
});

test('an English reader keeps the left-to-right layout', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Start', content: CONTENT }],
	});

	await page.goto(space.url('page', space.page('Start').name));

	await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
	await expect(page.locator('.wiki-rendered').first()).toHaveCSS(
		'direction',
		'ltr',
	);
});
