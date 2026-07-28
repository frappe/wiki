import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

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
		request,
	}) => {
		const spaceRoute = `blank-lines-space-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceRoute,
			is_published: true,
		});
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceRoute}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});
		const doc = await createTestWikiDocument(request, {
			title: 'Blank Lines Page',
			route: `${spaceRoute}/blank-lines`,
			content: CONTENT,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		try {
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
		} finally {
			await deleteTestWikiDocument(request, doc.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});
});
