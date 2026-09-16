import type { APIRequestContext, Browser } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createDoc } from '../helpers/frappe';

/**
 * A space with contributions switched off cannot open a change request, so a
 * reader lands on the read-only tree and is never offered a page they cannot
 * create. Regression: the draft path ran for them regardless, leaving the tree
 * on its loading skeleton and the palette offering a dead "New page".
 */
async function seedReader(request: APIRequestContext, stamp: string) {
	const email = `e2e-reader-${stamp}@example.com`;
	const password = `Reader-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E Reader',
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

test('a reader who cannot contribute gets the read-only tree, not a dead New page', async ({
	browser,
	request,
	wiki,
}, info) => {
	const stamp = Date.now().toString(36);
	const { email, password } = await seedReader(request, stamp);
	const space = await wiki.space({
		space_name: `NoContrib${stamp}`,
		allow_contributions: 0,
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
	await page.goto(space.url());

	// The tree hydrates, rather than sitting on its skeleton forever.
	await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByRole('button', { name: 'New page' })).toBeHidden();

	const palette = page.getByRole('dialog');
	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette.getByRole('combobox')).toBeFocused();
	await expect(palette.getByRole('option', { name: 'New page' })).toBeHidden();
	await expect(
		palette.getByRole('option', { name: 'Toggle theme' }),
	).toBeVisible();

	await context.close();
});

test('a reader who may contribute still gets New page', async ({
	browser,
	request,
	wiki,
}, info) => {
	const stamp = Date.now().toString(36);
	const { email, password } = await seedReader(request, stamp);
	const space = await wiki.space({
		space_name: `Contrib${stamp}`,
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
	await page.goto(space.url());
	await expect(page.getByRole('button', { name: 'New page' })).toBeVisible({
		timeout: 15000,
	});

	const palette = page.getByRole('dialog');
	await page.keyboard.press('ControlOrMeta+k');
	await expect(palette.getByRole('option', { name: 'New page' })).toBeVisible();

	await context.close();
});
