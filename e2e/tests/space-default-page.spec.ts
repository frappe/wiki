import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	type WikiDocument,
	type WikiSpace,
	cleanupWikiSpacesByRoute,
	createTestWikiDocument,
	createTestWikiSpace,
} from '../helpers/wiki';

/**
 * Opening a space in the editor should never strand the user on the "Select a
 * page" welcome screen: it auto-opens the first page, and on re-entry reopens
 * whichever page the user last had open (persisted per-space in localStorage).
 */
test.describe('Space default page', () => {
	const populatedRoute = `default-page-${Date.now()}`;
	const emptyRoute = `default-page-empty-${Date.now()}`;
	let space: WikiSpace;
	let alpha: WikiDocument;
	let beta: WikiDocument;
	let emptySpace: WikiSpace;

	test.beforeAll(async ({ request }) => {
		// A space with two published pages, Alpha before Beta.
		space = await createTestWikiSpace(request, {
			route: populatedRoute,
			is_published: true,
		});
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${populatedRoute}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});
		alpha = await createTestWikiDocument(request, {
			title: 'Alpha Page',
			route: `${populatedRoute}/alpha`,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		beta = await createTestWikiDocument(request, {
			title: 'Beta Page',
			route: `${populatedRoute}/beta`,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		// A space with no pages, to exercise the empty-tree fallback.
		emptySpace = await createTestWikiSpace(request, {
			route: emptyRoute,
			is_published: true,
		});
		const emptyRoot = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${emptyRoute}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', emptySpace.name, {
			root_group: emptyRoot.name,
		});
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, populatedRoute);
		await cleanupWikiSpacesByRoute(request, emptyRoute);
	});

	test('auto-opens the first page, then reopens the last opened page', async ({
		page,
	}) => {
		// Entering at the bare space route opens the first page (Alpha).
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForURL(`**/spaces/${space.name}/page/${alpha.name}`, {
			timeout: 15000,
		});

		// Open Beta directly — this records it as the last opened page.
		await page.goto(`/wiki/spaces/${space.name}/page/${beta.name}`);
		await page.waitForLoadState('networkidle');

		// Re-entering the bare space route now reopens Beta, not Alpha.
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForURL(`**/spaces/${space.name}/page/${beta.name}`, {
			timeout: 15000,
		});
	});

	test('stays on the welcome screen when the space has no pages', async ({
		page,
	}) => {
		await page.goto(`/wiki/spaces/${emptySpace.name}`);
		// Wait for the tree to resolve (sidebar reports it's empty), so any
		// redirect would already have happened.
		await expect(page.locator('aside >> text=No pages yet')).toBeVisible({
			timeout: 15000,
		});
		// No page was opened — URL is still the bare space route.
		await expect(page).toHaveURL(new RegExp(`/spaces/${emptySpace.name}$`));
		await expect(page.locator('text=Select a page')).toBeVisible();
	});
});
