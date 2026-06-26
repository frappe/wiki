import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import { createTestWikiDocument, createTestWikiSpace } from '../helpers/wiki';

/**
 * E2E tests for the editor tree fuzzy search box.
 * Verifies that typing filters the in-memory tree in place: matches stay,
 * non-matches are pruned, ancestor groups auto-expand, route-only matches
 * surface, and clearing the query restores the full tree.
 */
test.describe('Editor Tree Search', () => {
	test('filters the tree by title and route, then restores on clear', async ({
		page,
		request,
	}) => {
		const spaceName = `tree-search-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceName,
			is_published: true,
		});

		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceName}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		// Group "Guides" with two pages; one page matches only by route.
		const guides = await createTestWikiDocument(request, {
			title: 'Guides',
			route: `${spaceName}/guides`,
			is_group: true,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		await createTestWikiDocument(request, {
			title: 'Getting Started',
			route: `${spaceName}/guides/getting-started`,
			is_published: true,
			parent_wiki_document: guides.name,
		});
		await createTestWikiDocument(request, {
			title: 'Authentication',
			route: `${spaceName}/guides/auth-tokens`,
			is_published: true,
			parent_wiki_document: guides.name,
		});

		// A sibling group that should be pruned away on a "Guides" search.
		const reference = await createTestWikiDocument(request, {
			title: 'Reference',
			route: `${spaceName}/reference`,
			is_group: true,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		await createTestWikiDocument(request, {
			title: 'API Keys',
			route: `${spaceName}/reference/api-keys`,
			is_published: true,
			parent_wiki_document: reference.name,
		});

		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		const tree = page.locator('aside');
		await expect(tree.getByText('Guides', { exact: true })).toBeVisible({
			timeout: 10000,
		});

		const search = page.getByPlaceholder('Search pages...');
		await expect(search).toBeVisible();

		// Title match: keeps the page + its ancestor group (auto-expanded),
		// prunes the unrelated branch.
		await search.fill('getting');
		await expect(tree.getByText('Getting Started')).toBeVisible();
		await expect(tree.getByText('Guides', { exact: true })).toBeVisible();
		await expect(tree.getByText('Reference', { exact: true })).toHaveCount(0);
		await expect(tree.getByText('API Keys')).toHaveCount(0);
		await expect(tree.getByText('Authentication')).toHaveCount(0);

		// Route-only match: "auth-tokens" lives only in the route, not the title.
		await search.fill('auth-tokens');
		await expect(tree.getByText('Authentication')).toBeVisible();
		await expect(tree.getByText('Getting Started')).toHaveCount(0);

		// No matches: the empty state shows.
		await search.fill('zzzznomatch');
		await expect(tree.getByText('No matches')).toBeVisible();

		// Clearing restores the full tree.
		await search.fill('');
		await expect(tree.getByText('Guides', { exact: true })).toBeVisible();
		await expect(tree.getByText('Reference', { exact: true })).toBeVisible();

		// Cleanup.
		await page.unrouteAll({ behavior: 'ignoreErrors' });
	});
});
