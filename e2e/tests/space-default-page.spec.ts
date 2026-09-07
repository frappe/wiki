import { expect, test } from '../fixtures';
import type { SeededSpace } from '../helpers/factory';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';

/**
 * Opening a space in the editor should never strand the user on the "Select a
 * page" welcome screen: it auto-opens the first page, and on re-entry reopens
 * whichever page the user last had open (persisted per-space in localStorage).
 */
test.describe('Space default page', () => {
	let space: SeededSpace;
	let emptySpace: SeededSpace;

	test.beforeAll(async ({ wikiSuite }) => {
		// A space with two published pages, Alpha before Beta.
		space = await wikiSuite.space({
			pages: [{ title: 'Alpha Page' }, { title: 'Beta Page' }],
		});
		// A space with no pages, to exercise the empty-tree fallback.
		emptySpace = await wikiSuite.space();
	});

	test('auto-opens the first page, then reopens the last opened page', async ({
		page,
	}) => {
		const alpha = space.page('Alpha Page');
		const beta = space.page('Beta Page');

		// Entering at the bare space route opens the first page (Alpha).
		await page.goto(space.url());
		await page.waitForURL(`**/spaces/${space.name}/page/${alpha.name}`, {
			timeout: 15000,
		});

		// Open Beta directly — this records it as the last opened page. Wait on
		// the rendered title (the page-title input) rather than networkidle: it's
		// the "page mounted" signal the persist watcher rides on, and avoids
		// networkidle's flaky 500ms-quiet wait on slow CI.
		await page.goto(space.url('page', beta.name));
		await expect(page.getByPlaceholder('Page title')).toHaveValue('Beta Page', {
			timeout: 15000,
		});

		// Re-entering the bare space route now reopens Beta, not Alpha.
		await page.goto(space.url());
		await page.waitForURL(`**/spaces/${space.name}/page/${beta.name}`, {
			timeout: 15000,
		});
	});

	test('stays on the welcome screen when the space has no pages', async ({
		page,
	}) => {
		await page.goto(emptySpace.url());
		// Wait for the tree to resolve (sidebar reports it's empty), so any
		// redirect would already have happened.
		await expect(page.locator('aside >> text=No pages yet')).toBeVisible({
			timeout: 15000,
		});
		// No page was opened — URL is still the bare space route.
		await expect(page).toHaveURL(new RegExp(`/spaces/${emptySpace.name}$`));
		// The tree states the fact; the content column carries the action.
		const content = page.locator('main');
		await expect(content.getByText('Create your first page')).toBeVisible();
		await expect(
			content.getByRole('button', { name: 'New page', exact: true }),
		).toBeVisible();
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
	test('opens the switched-to space page, not the previous space page', async ({
		page,
		wiki,
	}) => {
		const spaceA = await wiki.space({
			space_name: 'Alpha Space',
			pages: [{ title: 'Alpha One' }, { title: 'Alpha Two' }],
		});
		const spaceB = await wiki.space({
			space_name: 'Bravo Space',
			pages: [{ title: 'Bravo One' }, { title: 'Bravo Two' }],
		});
		const aFirst = spaceA.page('Alpha One');
		const bFirst = spaceB.page('Bravo One');

		// Enter space A — it auto-opens A's first page and hydrates the singleton
		// draft store for A.
		await page.goto(spaceA.url());
		await page.waitForURL(`**/spaces/${spaceA.name}/page/${aFirst.name}`, {
			timeout: 15000,
		});

		// Switch to space B entirely in-app: back out to the library, then into B.
		// No full reload, so the store still holds A's tree at the moment B mounts.
		await page.locator('[title="Back to Overview"]').first().click();
		await page.waitForURL(new RegExp(`${APP_BASE}/?$`), { timeout: 15000 });
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
