import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';
import { generateWikiTitle } from '../helpers/wiki';

/**
 * Per-space "Accept Contributions" toggle — reader-side behavior.
 *
 * The public reader shows an Edit (split) button that lets readers raise change
 * requests. When a space turns contributions off, read-only viewers should no
 * longer see Edit — Copy (as Markdown) becomes the primary action and the other
 * actions (Download, Open in ChatGPT/Claude) stay. Users with write/merge
 * access (managers) always keep the Edit button.
 *
 * We seed a publicly readable space (Guest Read role) + a published page via the
 * API, then read it in a fresh Guest browser context (no stored auth) to
 * exercise the read-only path. Manager behavior is checked with the stored
 * (Administrator) auth state.
 */
test.describe('Accept Contributions toggle (reader)', () => {
	async function seedPublicPage(
		wiki: WikiFactory,
		allowContributions: boolean,
	): Promise<string> {
		const title = generateWikiTitle('Accept Contrib');
		const space = await wiki.space({
			allow_contributions: allowContributions ? 1 : 0,
			// Guest Read makes the space publicly readable (anonymous reader path).
			roles: [{ role: 'Guest', permission_level: 'Read' }],
			pages: [{ title, content: '# Heading\n\nReader body content.' }],
		});
		return `/${space.page(title).route}`;
	}

	test('shows Edit to a public reader when contributions are on', async ({
		wiki,
		browser,
		baseURL,
	}) => {
		const url = await seedPublicPage(wiki, true);

		// Explicitly logged-out context (the project default carries the admin
		// auth state) pointed at the same server.
		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		});
		const guestPage = await guest.newPage();
		await guestPage.setViewportSize({ width: 1100, height: 900 });
		await guestPage.goto(url);
		await guestPage.waitForLoadState('networkidle');

		// Desktop Edit link (last() = desktop block, which is the visible one).
		await expect(guestPage.locator('a.wiki-edit-link').last()).toBeVisible({
			timeout: 10000,
		});

		await guest.close();
	});

	test('hides Edit (Copy becomes primary) when contributions are off; other actions remain', async ({
		page,
		wiki,
		browser,
		baseURL,
	}) => {
		const url = await seedPublicPage(wiki, false);

		// --- Read-only viewer (Guest) ---
		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		});
		const guestPage = await guest.newPage();
		await guestPage.setViewportSize({ width: 1100, height: 900 });
		await guestPage.goto(url);
		await guestPage.waitForLoadState('networkidle');

		// No Edit affordance anywhere on the page.
		await expect(guestPage.locator('a.wiki-edit-link')).toHaveCount(0);

		// Copy is the primary action instead.
		await expect(
			guestPage.getByRole('button', { name: 'Copy', exact: true }).last(),
		).toBeVisible({ timeout: 10000 });

		// The other actions are still present (in the dropdown menu).
		await expect(guestPage.getByText('Open in ChatGPT').last()).toBeAttached();
		await expect(guestPage.getByText('Open in Claude').last()).toBeAttached();

		await guest.close();

		// --- Manager (stored Administrator auth) still sees Edit ---
		await page.setViewportSize({ width: 1100, height: 900 });
		await page.goto(url);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('a.wiki-edit-link').last()).toBeVisible({
			timeout: 10000,
		});
	});
});
