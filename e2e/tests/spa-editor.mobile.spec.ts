import { expect, test } from '@playwright/test';
import { cleanupWikiSpacesByRoute } from '../helpers/wiki';

/**
 * Phase 1 (mobile-friendly SPA) tracer + regression guard.
 *
 * The bug we guard against: on a phone the desktop sidebar(s) ate the screen
 * and the editor collapsed to a sliver. After the drawer/top-nav work the
 * editor must fill the width and the space tree must be reachable via a drawer.
 *
 * Kept deliberately to a single test (project memory: e2e flooding the local
 * job queue). Setup creates the space + page at a desktop viewport, then we
 * drop to a 375px phone viewport for the actual assertions.
 */

const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1100, height: 900 };

test.describe('Mobile SPA editor', () => {
	let spaceRoute = '';

	test.afterEach(async ({ request }) => {
		if (spaceRoute) {
			await cleanupWikiSpacesByRoute(request, spaceRoute).catch(() => {});
		}
	});

	test('tree opens in a drawer and the editor fills the screen at 375px', async ({
		page,
	}) => {
		const stamp = Date.now();
		spaceRoute = `mobile-spa-${stamp}`;
		const pageTitle = `Mobile Page ${stamp}`;

		// --- Setup at desktop: create a space with one page ---
		await page.setViewportSize(DESKTOP);
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceRoute);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await expect(page).toHaveURL(/\/wiki\/spaces\//);
		await page.waitForLoadState('networkidle');
		const spaceUrl = page.url();

		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await page.locator('button[title="New Page"]').click();
		}
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// --- Switch to a phone viewport at the space root ---
		await page.setViewportSize(PHONE);
		await page.goto(spaceUrl);
		await page.waitForLoadState('networkidle');

		// Desktop inline tree must be gone; the contextual header lives in the
		// top nav with a tree toggle.
		const treeToggle = page.locator('#app-header').getByTitle('Pages');
		await expect(treeToggle).toBeVisible();

		// Open the off-canvas tree drawer and pick the page.
		await treeToggle.click();
		const drawer = page.getByRole('dialog');
		await expect(drawer).toBeVisible();
		const pageLink = drawer.getByText(pageTitle, { exact: true });
		await expect(pageLink).toBeVisible();
		await pageLink.click();

		// Drawer auto-closes on navigation; the editor takes over full width.
		await expect(drawer).not.toBeVisible();

		const editor = page.locator('.ProseMirror').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Regression guard: a usable editor width, not a sliver. (Reverting the
		// Phase-1 drawer change drops this well below 300px.)
		const box = await editor.boundingBox();
		expect(box?.width ?? 0).toBeGreaterThan(300);

		// ...and it is focusable / accepts input.
		await editor.click();
		await page.keyboard.type('Typed on a phone.');
		await expect(editor).toContainText('Typed on a phone.');
	});
});
