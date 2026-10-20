import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

type EditorWindow = Window & { wikiEditor?: unknown };

async function openEditor(page: Page, url: string) {
	await page.goto(url);
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as EditorWindow).wikiEditor !== undefined,
	);
	await page.waitForLoadState('networkidle');
}

function recordMethodCalls(page: Page) {
	const calls: string[] = [];
	page.on('request', (request) => {
		const match = request.url().match(/\/api\/method\/(?:.*\.)?([^./?]+)/);
		if (match) calls.push(match[1]);
	});
	return calls;
}

test.describe('Save requests', () => {
	test('an autosave makes one request and updates the change count', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Autosave', content: 'Start.' }],
		});
		await openEditor(page, space.url('page', space.page('Autosave').name));
		const calls = recordMethodCalls(page);

		await page.locator('.ProseMirror').first().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' Saved once.');

		await expect(page.getByText('1 page changed')).toBeVisible({
			timeout: 10000,
		});
		// The old code fetched the page and the summary after the save landed.
		await page.waitForTimeout(2000);
		expect(calls).toEqual(['apply_cr_operations']);
	});

	test('a title change makes one request', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Old title', content: 'Body.' }],
		});
		await openEditor(page, space.url('page', space.page('Old title').name));
		const calls = recordMethodCalls(page);

		const title = page.getByPlaceholder('Page title');
		await title.fill('New title');
		await title.press('Enter');

		await expect(page.getByText('1 page changed')).toBeVisible({
			timeout: 10000,
		});
		await page.waitForTimeout(2000);
		expect(calls).toEqual(['apply_cr_operations']);
		await expect(title).toHaveValue('New title');
	});
});
