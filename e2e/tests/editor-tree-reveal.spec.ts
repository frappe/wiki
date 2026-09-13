import { expect, test } from '../fixtures';
import type { SeededPage, SeededSpace } from '../helpers/factory';

/**
 * The editor tree must reveal the page being edited when it is opened from
 * outside the tree (the reader's Edit link, a reload, a deep link): expand its
 * ancestor groups and scroll its row into view, as the reader sidebar does
 * (see issue #521).
 */
test.describe('Editor tree reveals the current page', () => {
	let space: SeededSpace;
	let deepPage: SeededPage;
	let lastFiller: SeededPage;

	const FILLER_COUNT = 30;

	test.beforeAll(async ({ wikiSuite }) => {
		const fillerTitles = Array.from(
			{ length: FILLER_COUNT },
			(_, i) => `Filler Page ${String(i).padStart(2, '0')}`,
		);
		space = await wikiSuite.space({
			pages: [
				{ title: 'Top Page' },
				// Two collapsed levels above the page the tree has to reveal.
				{
					title: 'Outer Group',
					is_group: true,
					children: [
						{
							title: 'Inner Group',
							is_group: true,
							children: [{ title: 'Deep Page' }],
						},
					],
				},
				// Enough siblings to push the last one below the fold.
				...fillerTitles.map((title) => ({ title })),
			],
		});
		deepPage = space.page('Deep Page');
		lastFiller = space.page(fillerTitles[fillerTitles.length - 1]);
	});

	test('Edit from the reader expands the ancestor groups', async ({ page }) => {
		await page.goto(`/${deepPage.route}`);
		await page.locator('.wiki-edit-link:visible').first().click();
		await page.waitForURL(`**${space.url('page', deepPage.name)}`);

		const selected = page.locator('aside [data-selected]');
		await expect(selected).toHaveText('Deep Page');
		await expect(selected).toBeInViewport();
	});

	test('loading the editor scrolls a far-down page into view', async ({
		page,
	}) => {
		await page.goto(space.url('page', lastFiller.name));

		const selected = page.locator('aside [data-selected]');
		await expect(selected).toHaveText(lastFiller.title);
		await expect(selected).toBeInViewport();
	});
});
