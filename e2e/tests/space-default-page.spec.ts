import { type APIRequestContext, expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import { appUrl, spaceLinkSelector } from '../helpers/routes';
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
		await page.goto(appUrl('spaces', space.name));
		await page.waitForURL(`**/spaces/${space.name}/page/${alpha.name}`, {
			timeout: 15000,
		});

		// Open Beta directly — this records it as the last opened page. Wait on
		// the rendered title (the page-title input) rather than networkidle: it's
		// the "page mounted" signal the persist watcher rides on, and avoids
		// networkidle's flaky 500ms-quiet wait on slow CI.
		await page.goto(appUrl('spaces', space.name, 'page', beta.name));
		await expect(page.getByPlaceholder('Page title')).toHaveValue('Beta Page', {
			timeout: 15000,
		});

		// Re-entering the bare space route now reopens Beta, not Alpha.
		await page.goto(appUrl('spaces', space.name));
		await page.waitForURL(`**/spaces/${space.name}/page/${beta.name}`, {
			timeout: 15000,
		});
	});

	test('stays on the welcome screen when the space has no pages', async ({
		page,
	}) => {
		await page.goto(appUrl('spaces', emptySpace.name));
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

/**
 * Regression: switching between spaces *in-app* (without a full reload) must
 * open the new space's page, never the previous space's. SpaceDetails is reused
 * across /spaces/:spaceId and the draft store is a global singleton, so the
 * previous space's tree lingers during the switch — auto-open used to navigate
 * into that stale tree's page. The earlier tests miss this because they enter
 * each space with a fresh page.goto().
 */
test.describe('Space default page — in-app space switch', () => {
	const ts = Date.now();
	const routeA = `switch-a-${ts}`;
	const routeB = `switch-b-${ts}`;
	const nameB = `Bravo Space ${ts}`;
	let spaceA: WikiSpace;
	let spaceB: WikiSpace;
	let aFirst: WikiDocument;
	let bFirst: WikiDocument;

	async function buildSpace(
		request: APIRequestContext,
		route: string,
		spaceName: string,
		pagePrefix: string,
	): Promise<{ space: WikiSpace; firstPage: WikiDocument }> {
		const space = await createTestWikiSpace(request, {
			route,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			space_name: spaceName,
		});
		const rootGroup = await createTestWikiDocument(request, {
			title: `${pagePrefix} Root`,
			route: `${route}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});
		const firstPage = await createTestWikiDocument(request, {
			title: `${pagePrefix} One`,
			route: `${route}/one`,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		await createTestWikiDocument(request, {
			title: `${pagePrefix} Two`,
			route: `${route}/two`,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		return { space, firstPage };
	}

	test.beforeAll(async ({ request }) => {
		({ space: spaceA, firstPage: aFirst } = await buildSpace(
			request,
			routeA,
			`Alpha Space ${ts}`,
			'Alpha',
		));
		({ space: spaceB, firstPage: bFirst } = await buildSpace(
			request,
			routeB,
			nameB,
			'Bravo',
		));
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, routeA);
		await cleanupWikiSpacesByRoute(request, routeB);
	});

	test('opens the switched-to space page, not the previous space page', async ({
		page,
	}) => {
		// Enter space A — it auto-opens A's first page and hydrates the singleton
		// draft store for A.
		await page.goto(appUrl('spaces', spaceA.name));
		await page.waitForURL(`**/spaces/${spaceA.name}/page/${aFirst.name}`, {
			timeout: 15000,
		});

		// Switch to space B entirely in-app: back to the list, then into B. No
		// full reload, so the store still holds A's tree at the moment B mounts.
		await page.locator('[title="Back to Spaces"]').click();
		await page.waitForURL(/\/spaces$/, { timeout: 15000 });
		// Target the row by its href (router-link) — robust to how the row text
		// is rendered — and click it for a client-side nav into B.
		await page.locator(spaceLinkSelector(spaceB.name)).first().click();

		// B must open *B's* first page — not A's page from the stale tree.
		await page.waitForURL(`**/spaces/${spaceB.name}/page/${bFirst.name}`, {
			timeout: 15000,
		});
		expect(page.url()).not.toContain(`/page/${aFirst.name}`);
	});
});
