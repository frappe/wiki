import type { APIRequestContext, Browser } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createDoc } from '../helpers/frappe';

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
