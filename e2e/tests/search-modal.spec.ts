import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

/**
 * Tests for the public reader search modal (search_modal.html).
 *
 * The search API is stubbed via route interception: the SQLite search index
 * is only refreshed by a 5-minute scheduler job, so freshly created test
 * pages are never searchable in time. The modal's behavior (rendering,
 * keyboard navigation, selection) is what's under test, not the indexer.
 *
 * The keyboard test guards a past regression: the modal bound a fresh
 * keydown handler on every open (`removeEventListener` never matched the
 * new `.bind()` result), so after N opens each ArrowDown moved the
 * highlight N rows — hence the open/close/reopen dance.
 */

const SEARCH_API =
	'**/api/method/wiki.frappe_wiki.doctype.wiki_document.search.search*';
const SEARCH_INPUT = 'input[placeholder="Search documentation"]';

test.describe('Search Modal', () => {
	test('keyboard navigation moves one result per keypress across reopens', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceRoute = `search-modal-space-${timestamp}`;

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
		const hostPage = await createTestWikiDocument(request, {
			title: `Search Host ${timestamp}`,
			route: `${spaceRoute}/search-host`,
			content: 'Host page for the search modal test.',
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		const targetPage = await createTestWikiDocument(request, {
			title: `Search Target ${timestamp}`,
			route: `${spaceRoute}/search-target`,
			content: 'Target page the second result points at.',
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		await page.route(SEARCH_API, (route) =>
			route.fulfill({
				json: {
					message: {
						results: [
							{
								name: 'stub-1',
								title: 'First <mark>stub</mark> result',
								route: `${spaceRoute}/search-host`,
								content: 'Snippet for the first <mark>stub</mark>.',
								score: 3,
							},
							{
								name: 'stub-2',
								title: 'Second <mark>stub</mark> result',
								route: `${spaceRoute}/search-target`,
								content: 'Snippet for the second <mark>stub</mark>.',
								score: 2,
							},
							{
								name: 'stub-3',
								title: 'Third <mark>stub</mark> result',
								route: `${spaceRoute}/search-host`,
								content: 'Snippet for the third <mark>stub</mark>.',
								score: 1,
							},
						],
						total: 3,
					},
				},
			}),
		);

		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(`/${hostPage.route}`);
			await page.waitForLoadState('networkidle');

			const searchInput = page.locator(SEARCH_INPUT);
			const results = page.getByTestId('search-result');

			// First open: results render for the query
			await page.getByRole('button', { name: 'Open search' }).click();
			await expect(searchInput).toBeVisible();
			await searchInput.fill('stub');
			await expect(results).toHaveCount(3);

			// Close and reopen — a leaked keydown listener from the first open
			// would now double every arrow-key step
			await page.keyboard.press('Escape');
			await expect(searchInput).toBeHidden();
			await page.getByRole('button', { name: 'Open search' }).click();
			await searchInput.fill('stub');
			await expect(results).toHaveCount(3);

			// One ArrowDown must move the highlight exactly one row
			await page.keyboard.press('ArrowDown');
			await expect(results.nth(1)).toHaveClass(/surface-gray-3/);
			await expect(results.nth(0)).not.toHaveClass(/surface-gray-3/);
			await expect(results.nth(2)).not.toHaveClass(/surface-gray-3/);

			// Enter navigates to the highlighted (second) result
			await page.keyboard.press('Enter');
			await page.waitForURL(`**/${targetPage.route}`, { timeout: 10000 });
		} finally {
			await deleteTestWikiDocument(request, targetPage.name).catch(() => {});
			await deleteTestWikiDocument(request, hostPage.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});
});
