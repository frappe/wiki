import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createDoc } from '../helpers/frappe';
import { APP_BASE } from '../helpers/routes';

async function openHeaderMenu(page: Page) {
	await page.goto(APP_BASE);
	await page
		.locator('[data-slot="sidebar"]')
		.getByRole('button', { name: /Frappe Wiki/ })
		.click();
	await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
}

test('a System User switches to Desk from the header menu', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openHeaderMenu(page);

	await page.getByRole('menuitem', { name: 'Apps' }).hover();
	await page.getByRole('menuitem', { name: 'Desk' }).click();

	await expect(page).toHaveURL(/\/(app|desk)(\/|$)/);
});

test('a Website User gets no Apps item, since Desk would turn them away', async ({
	browser,
	baseURL,
	request,
}) => {
	const stamp = Date.now().toString(36);
	const email = `e2e-website-${stamp}@example.com`;
	const password = `Website-${stamp}!`;
	// No desk roles keeps them a Website User; wiki's after_insert hook still grants Wiki User.
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E Website',
		new_password: password,
		send_welcome_email: 0,
	});

	const context = await browser.newContext({ baseURL });
	const login = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(login.ok()).toBeTruthy();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });

	await openHeaderMenu(page);

	await expect(page.getByRole('menuitem', { name: 'Apps' })).toHaveCount(0);
	await context.close();
});
