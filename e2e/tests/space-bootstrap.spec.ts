import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

function recordMethodCalls(page: Page) {
	const calls: string[] = [];
	page.on('request', (request) => {
		const match = request.url().match(/\/api\/method\/(?:.*\.)?([^./?]+)/);
		if (match) calls.push(match[1]);
	});
	return calls;
}

test.describe('Space bootstrap', () => {
	test('opening the app does not fetch the user', async ({ page, wiki }) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const calls = recordMethodCalls(page);

		await page.goto(space.url());
		await expect(
			page.locator('aside').getByText('Alpha', { exact: true }),
		).toBeVisible({ timeout: 15000 });

		expect(calls).not.toContain('get_user_info');
	});
});
