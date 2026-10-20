import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

function recordApiCalls(page: Page) {
	const calls: string[] = [];
	page.on('request', (request) => {
		const url = request.url();
		if (url.includes('/api/')) calls.push(url);
	});
	return calls;
}

test.describe('Space bootstrap', () => {
	test('opening a space loads the user, the space and the draft in one request', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		const calls = recordApiCalls(page);

		await page.goto(space.url());
		await expect(
			page.locator('aside').getByText('Alpha', { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			page.locator('.ProseMirror[contenteditable="true"]'),
		).toBeVisible();

		const called = (name: string) => calls.filter((url) => url.includes(name));
		expect(called('get_space_bootstrap')).toHaveLength(1);
		expect(called('get_user_info')).toEqual([]);
		expect(called('get_space_capabilities')).toEqual([]);
		expect(called('get_or_create_draft_change_request')).toEqual([]);
		expect(called('doctype=Wiki+Space&')).toEqual([]);
	});
});
