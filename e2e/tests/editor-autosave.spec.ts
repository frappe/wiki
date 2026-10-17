import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod } from '../helpers';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

type EditorWindow = Window & {
	wikiEditor?: unknown;
	__draftStore?: { crName: string | null };
};

async function openEditor(page: Page, url: string) {
	await page.goto(url);
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as EditorWindow).wikiEditor !== undefined,
	);
}

// Content saves the server accepted, with when they landed and what they sent.
function recordContentSaves(page: Page) {
	const saves: { at: number; body: string }[] = [];
	page.on('response', (response) => {
		const body = response.request().postData() ?? '';
		if (
			response.url().includes('apply_cr_operations') &&
			body.includes('update_content') &&
			response.ok()
		) {
			saves.push({ at: Date.now(), body });
		}
	});
	return saves;
}

async function savedContent(page: Page, docKey: string) {
	const crName = await page.evaluate(
		() => (window as EditorWindow).__draftStore?.crName,
	);
	const crPage = await callMethod<{ content: string }>(
		page.request,
		`${CR_METHOD}.get_cr_page`,
		{ name: crName, doc_key: docKey },
	);
	return crPage.content;
}

test.describe('Editor autosave', () => {
	test('saves soon after typing pauses', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Pause', content: 'Start.' }],
		});
		const seeded = space.page('Pause');
		await openEditor(page, space.url('page', seeded.name));
		const saves = recordContentSaves(page);

		await page.locator('.ProseMirror').first().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' Paused here.');
		const pausedAt = Date.now();

		await expect.poll(() => saves.length, { timeout: 6000 }).toBeGreaterThan(0);
		expect(saves[0].at - pausedAt).toBeLessThan(6000);
		expect(await savedContent(page, seeded.doc_key)).toContain('Paused here.');
	});

	test('saves while typing never pauses', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [{ title: 'Typing', content: 'Start.' }],
		});
		const seeded = space.page('Typing');
		await openEditor(page, space.url('page', seeded.name));
		const saves = recordContentSaves(page);

		await page.locator('.ProseMirror').first().click();
		await page.keyboard.press('End');
		const startedAt = Date.now();
		let word = 0;
		// A key every 150 ms, so no gap is long enough for the idle debounce.
		while (Date.now() - startedAt < 13000) {
			await page.keyboard.type(` w${word++}`, { delay: 150 });
		}
		const stoppedAt = Date.now();

		const savedWhileTyping = saves.filter((save) => save.at < stoppedAt);
		expect(savedWhileTyping.length).toBeGreaterThan(0);
		expect(savedWhileTyping[0].body).toContain('w0');
		expect(await savedContent(page, seeded.doc_key)).toContain('Start. w0 w1');
	});
});
