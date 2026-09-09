import { expect, test } from '../fixtures';

/**
 * prose-v3 zeroes paragraph margins: blank lines the author typed are the only
 * thing carrying vertical rhythm. The server renderer materialises them as
 * <p class="wiki-blank-line"><br></p>. Unit tests can prove the markup, only a
 * browser can prove the gap has height — an empty <p> would collapse to 0px.
 */
const CONTENT = 'First paragraph\n\n\n\n\n\nSecond paragraph';

test.describe('Public page blank lines', () => {
	test('renders author blank lines as gaps with real height', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Blank Lines Page', content: CONTENT }],
		});
		const doc = space.page('Blank Lines Page');

		await page.goto(`/${doc.route}`);
		await page.waitForLoadState('networkidle');

		// Two extra blank lines in the markdown => two blank paragraphs.
		const blanks = page.locator('#wiki-content .wiki-blank-line');
		await expect(blanks).toHaveCount(2);

		for (const blank of await blanks.all()) {
			const box = await blank.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThan(0);
		}

		const first = await page
			.locator('#wiki-content p', { hasText: 'First paragraph' })
			.first()
			.boundingBox();
		const second = await page
			.locator('#wiki-content p', { hasText: 'Second paragraph' })
			.first()
			.boundingBox();

		// Without the blank paragraphs the two would sit flush (~one line apart).
		const delta = (second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0));
		expect(delta).toBeGreaterThan(30);
	});
});
