import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const TEXT = 'The quick brown fox jumps over the lazy dog.';

function weights(page: Page, scope: string) {
	return page.evaluate((scope) => {
		const root = document.querySelector(scope);
		const weight = (selector: string) => {
			const el = root?.querySelector(selector);
			return el ? getComputedStyle(el).fontWeight : null;
		};
		return { paragraph: weight(':scope > p'), quote: weight('blockquote p') };
	}, scope);
}

test('a quote uses the body text weight when read and when edited', async ({
	page,
	wiki,
}) => {
	const space = await wiki.space({
		pages: [{ title: 'Quote Page', content: `${TEXT}\n\n> ${TEXT}` }],
	});
	const url = space.url('page', space.page('Quote Page').name);

	await page.goto(url);
	await expect(page.locator('.wiki-rendered blockquote')).toBeVisible({
		timeout: 15000,
	});
	const read = await weights(page, '.wiki-rendered');
	expect(read.paragraph).not.toBeNull();
	expect(read.quote).toBe(read.paragraph);

	await wiki.changeRequest(space);
	await page.goto(url);
	await expect(page.locator('.ProseMirror blockquote')).toBeVisible({
		timeout: 15000,
	});
	const edited = await weights(page, '.ProseMirror');
	expect(edited.paragraph).not.toBeNull();
	expect(edited.quote).toBe(edited.paragraph);
});
