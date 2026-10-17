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
}

// Times at which the client sent a page's content to the server.
function recordContentSaves(page: Page) {
	const sentAt: number[] = [];
	page.on('request', (request) => {
		if (
			request.url().includes('apply_cr_operations') &&
			request.postData()?.includes('update_content')
		) {
			sentAt.push(Date.now());
		}
	});
	return sentAt;
}

test.describe('Editor autosave', () => {
	test('saves soon after typing pauses', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Pause', content: 'Start.' }],
		});
		await openEditor(page, space.url('page', space.page('Pause').name));
		const saves = recordContentSaves(page);

		await page.locator('.ProseMirror').first().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' Paused here.');
		const pausedAt = Date.now();

		await expect.poll(() => saves.length, { timeout: 6000 }).toBeGreaterThan(0);
		expect(saves[0] - pausedAt).toBeLessThan(6000);
		await expect(page.getByText('Unsaved changes')).toHaveCount(0, {
			timeout: 10000,
		});
	});

	test('saves while typing never pauses', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Typing', content: 'Start.' }],
		});
		await openEditor(page, space.url('page', space.page('Typing').name));
		const saves = recordContentSaves(page);

		await page.locator('.ProseMirror').first().click();
		await page.keyboard.press('End');
		const startedAt = Date.now();
		// A key every 150 ms, so no gap is long enough for the idle debounce.
		while (Date.now() - startedAt < 13000) {
			await page.keyboard.type(' word', { delay: 150 });
		}

		expect(saves.length).toBeGreaterThan(0);
	});
});
