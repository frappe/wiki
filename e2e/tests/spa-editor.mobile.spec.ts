import { expect, test } from '../fixtures';
import { uniqueRoute } from '../helpers/factory';
import { SPACE_URL_RE, appUrl } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

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
	// Phase 1: the bug we guard against is the editor collapsing to a sliver
	// because the desktop sidebars ate the screen. The tree must live in a
	// drawer and the editor must fill the width.
	test('tree opens in a drawer and the editor fills the screen at 375px', async ({
		page,
		wiki,
	}) => {
		const spaceRoute = uniqueRoute('mobile-spa');
		const pageTitle = `Mobile Page ${Date.now()}`;

		// --- Setup at desktop: create a space with one page ---
		await page.setViewportSize(DESKTOP);
		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceRoute);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await expect(page).toHaveURL(SPACE_URL_RE);
		await page.waitForLoadState('networkidle');
		const spaceUrl = page.url();
		wiki.adopt(spaceUrl.split('/spaces/')[1].split(/[/?#]/)[0]);

		await openNewPageDialog(page);
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
		const treeToggle = page.getByRole('button', { name: 'Pages' });
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
		wiki,
	}) => {
		const { route: spaceRoute } = await wiki.space();

		await page.setViewportSize(PHONE);
		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');

		await expect(
			page.getByRole('heading', { name: 'Spaces', exact: true }),
		).toBeVisible();
		// The header stacks and the table scrolls inside its container, so the
		// page itself must not gain a horizontal scrollbar.
		expect(await pageOverflow(page)).toBeLessThanOrEqual(1);

		// The created space shows as a row and the row navigates to its editor.
		const row = page.getByText(spaceRoute, { exact: true }).first();
		await expect(row).toBeVisible();
		await row.click();
		await expect(page).toHaveURL(SPACE_URL_RE);

		await page.goto(appUrl('change-requests'));
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
		wiki,
	}) => {
		const space = await wiki.space();

		await page.setViewportSize(PHONE);
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		// Open the tree drawer, then Settings from inside it.
		await page.getByRole('button', { name: 'Pages' }).click();
		const drawer = page.locator('.drawer-content');
		await expect(drawer).toBeVisible();
		await drawer.getByTitle('Settings').click();

		// Drawer closes; the settings dialog is the only modal left.
		await expect(drawer).toBeHidden();
		await expect(page.getByText('Access', { exact: true })).toBeVisible();
	});
});
