import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures';
import { appUrl } from '../helpers/routes';

const IS_CONNECTED = '**/api/method/wiki.api.github.is_connected*';

async function openGitSyncSection(page: Page) {
	await page.route('**/api/method/wiki.api.github.app_install_url*', (route) =>
		route.fulfill({
			json: { message: 'https://github.com/apps/e2e/installations/new' },
		}),
	);
	await page.goto(appUrl());
	await page.getByRole('button', { name: 'New Space' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Synced from GitHub?').check();
	return dialog;
}

test.describe('New Space -> connect GitHub', () => {
	test('keeps the connect panel steady while waiting for the popup', async ({
		page,
	}) => {
		// The first check answers at once; later polls are held so the test can
		// look at the dialog while a poll is in flight.
		const held: Route[] = [];
		let calls = 0;
		await page.route(IS_CONNECTED, (route) => {
			calls += 1;
			if (calls === 1) return route.fulfill({ json: { message: false } });
			held.push(route);
		});
		await page.addInitScript(() => {
			window.open = () => ({ closed: false, close() {} }) as unknown as Window;
		});

		const dialog = await openGitSyncSection(page);
		const connect = dialog.getByRole('button', { name: 'Connect GitHub' });
		await connect.click();

		await expect.poll(() => held.length, { timeout: 5000 }).toBeGreaterThan(0);
		await expect(dialog.getByText('Connecting to GitHub…')).toHaveCount(0);
		await expect(connect).toBeVisible();

		for (const route of held.splice(0))
			await route.fulfill({ json: { message: false } });
		await page.unroute(IS_CONNECTED);
	});

	test('connects in the same tab when the popup is blocked', async ({
		page,
	}) => {
		await page.route(IS_CONNECTED, (route) =>
			route.fulfill({ json: { message: false } }),
		);
		await page.route('**/github/authorize', (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<p>GitHub authorize</p>',
			}),
		);
		await page.addInitScript(() => {
			window.open = () => null;
		});

		const dialog = await openGitSyncSection(page);
		await dialog.getByRole('button', { name: 'Connect GitHub' }).click();

		await page.waitForURL(/\/github\/authorize$/);
	});
});
