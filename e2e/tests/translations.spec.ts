import { expect, test } from '../fixtures';
import { createDoc } from '../helpers/frappe';

/**
 * The SPA reads wiki's own catalog from the page boot, so a Spanish user sees
 * Spanish on first paint and the app never fetches translations after mount.
 */
test('a Spanish user gets the wiki catalog in the boot', async ({
	browser,
	request,
}, info) => {
	const stamp = Date.now().toString(36);
	const email = `e2e-es-${stamp}@example.com`;
	const password = `Lector-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E Lector',
		new_password: password,
		send_welcome_email: 0,
		language: 'es',
		roles: [{ role: 'Wiki User' }],
	});

	const context = await browser.newContext({
		baseURL: info.project.use.baseURL,
	});
	const login = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(login.ok()).toBeTruthy();

	const page = await context.newPage();
	const translationRequests: string[] = [];
	page.on('request', (req) => {
		if (/translat/i.test(req.url())) translationRequests.push(req.url());
	});

	await page.goto('/wiki-app');

	const bootedCatalog = await page.evaluate(() => window.translated_messages);
	expect(bootedCatalog?.Search).toBe('Buscar');
	await expect(page.getByText('Buscar', { exact: true })).toBeVisible();
	await page.waitForLoadState('networkidle');
	expect(translationRequests).toEqual([]);

	await context.close();
});

declare global {
	interface Window {
		translated_messages?: Record<string, string>;
	}
}
