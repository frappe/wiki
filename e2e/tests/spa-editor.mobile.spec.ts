import { expect, test } from '@playwright/test';
import { cleanupWikiSpacesByRoute, createTestWikiSpace } from '../helpers/wiki';

/**
 * Mobile-friendly SPA (Phases 1-2) tracer + regression guards, on a phone
 * viewport. Kept lean (project memory: e2e flooding the local job queue).
 */

const PHONE = { width: 375, height: 667 };
const DESKTOP = { width: 1100, height: 900 };

/** Page-level horizontal overflow in px (tables scroll inside their own
 * container, so the page itself must not gain a horizontal scrollbar). */
async function pageOverflow(page: import('@playwright/test').Page) {
	return page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
}

test.describe('Mobile SPA', () => {
	const createdRoutes: string[] = [];

	test.afterEach(async ({ request }) => {
		while (createdRoutes.length) {
			const route = createdRoutes.pop() as string;
			await cleanupWikiSpacesByRoute(request, route).catch(() => {});
		}
	});

	// Phase 1: the bug we guard against is the editor collapsing to a sliver
	// because the desktop sidebars ate the screen. The tree must live in a
	// drawer and the editor must fill the width.
	test('tree opens in a drawer and the editor fills the screen at 375px', async ({
		page,
	}) => {
		const stamp = Date.now();
		const spaceRoute = `mobile-spa-${stamp}`;
		createdRoutes.push(spaceRoute);
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

		// Phase 3: the toolbar must not hide its right-hand actions on a phone —
		// it overflows and scrolls horizontally instead of wrapping or clipping.
		const toolbar = page.locator('.wiki-toolbar');
		await expect(toolbar).toBeVisible();
		const toolbarScrolls = await toolbar.evaluate(
			(el) => el.scrollWidth > el.clientWidth,
		);
		expect(toolbarScrolls).toBe(true);
	});

	// Phase 2: list surfaces stay usable on a phone — headers stack instead of
	// colliding, tables scroll inside their own box (no page-level overflow),
	// and rows still navigate.
	test('Spaces and Change Requests render without page overflow; rows navigate', async ({
		page,
		request,
	}) => {
		const spaceRoute = `mobile-list-${Date.now()}`;
		createdRoutes.push(spaceRoute);
		await createTestWikiSpace(request, { route: spaceRoute });

		await page.setViewportSize(PHONE);
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		await expect(
			page.getByRole('heading', { name: 'Wiki Spaces' }),
		).toBeVisible();
		// The header stacks and the table scrolls inside its container, so the
		// page itself must not gain a horizontal scrollbar.
		expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

		// The created space shows as a row and the row navigates to its editor.
		const row = page.getByText(spaceRoute, { exact: true }).first();
		await expect(row).toBeVisible();
		await row.click();
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		await page.goto('/wiki/change-requests');
		await page.waitForLoadState('networkidle');
		await expect(
			page.getByRole('heading', { name: 'Change Requests' }),
		).toBeVisible();
		expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
	});

	// Regression: Settings opens from inside the tree drawer. The drawer must
	// close first, or the settings dialog stacks behind it and the drawer's
	// backdrop swallows the dialog's outside-click.
	test('Settings opens on top of the tree drawer, not behind it', async ({
		page,
		request,
	}) => {
		const spaceRoute = `mobile-settings-${Date.now()}`;
		createdRoutes.push(spaceRoute);
		const space = await createTestWikiSpace(request, { route: spaceRoute });

		await page.setViewportSize(PHONE);
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		// Open the tree drawer, then Settings from inside it.
		await page.locator('#app-header').getByTitle('Pages').click();
		const drawer = page.locator('.drawer-content');
		await expect(drawer).toBeVisible();
		await drawer.getByTitle('Settings').click();

		// Drawer closes; the settings dialog is the only modal left.
		await expect(drawer).toBeHidden();
		await expect(page.getByText('Permissions', { exact: true })).toBeVisible();
	});
});
