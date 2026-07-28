import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';
import {
	APP_BASE,
	CHANGE_REQUEST_URL_RE,
	SPACE_URL_RE,
	appUrl,
	spaceLinkSelector,
} from '../helpers/routes';
import {
	cleanupWikiSpacesByRoute,
	createTestWikiSpace,
	openNewPageDialog,
	publishChangeRequestFromReview,
} from '../helpers/wiki';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

/**
 * Tests for the wiki editor and admin functionality.
 * For public-facing page tests (TOC, sidebar), see public-pages.spec.ts
 */
test.describe('Wiki Editor', () => {
	// Spaces created via API for tests that need a clean, isolated space rather
	// than reusing whatever "first available space" happens to exist.
	const createdRoutes: string[] = [];
	test.afterAll(async ({ request }) => {
		for (const route of createdRoutes) {
			await cleanupWikiSpacesByRoute(request, route);
		}
	});

	test('should display wiki spaces list', async ({ page }) => {
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		// Should be on wiki page, not redirected to login
		await expect(page).not.toHaveURL(/.*login.*/);

		// Should show the spaces list view with at least one space or the empty state
		const spacesContainer = page.locator(
			`[data-testid="wiki-spaces"], .wiki-spaces-list, ${spaceLinkSelector()}`,
		);
		await expect(spacesContainer.first()).toBeVisible();
	});

	test('should create a new wiki space via UI', async ({ page }) => {
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		// Click create new space button
		await page.click('button:has-text("New Space")');

		// Fill in space details in the dialog (scope to dialog to avoid hitting search input)
		const dialog = page.locator('[role="dialog"]').first();
		await dialog.waitFor({ state: 'visible' });

		const spaceName = `Test Space ${Date.now()}`;
		await dialog.locator('input[type="text"]').first().fill(spaceName);

		// Wait for route to auto-populate from space name
		await page.waitForTimeout(500);

		// Submit the form (click Create button inside the dialog)
		await dialog.locator('button:has-text("Create")').click();

		// Wait for the dialog to close and page to update
		await page.waitForLoadState('networkidle');

		// Verify the space was created: check URL changed and space name visible.
		// In change-request mode the name lives in the top banner rather than the
		// tree aside; the timestamped name is unique, so match it page-wide.
		await expect(page).toHaveURL(SPACE_URL_RE, { timeout: 10000 });
		await expect(
			page.getByText(spaceName, { exact: true }).first(),
		).toBeVisible();
	});

	test('should navigate to space and create a wiki page', async ({
		page,
		request,
	}) => {
		// Create a dedicated, empty space rather than reusing whatever space
		// happens to be first — that shared space can carry an in-progress draft
		// from another test, which made this flaky.
		const spaceRoute = `create-page-${Date.now()}`;
		createdRoutes.push(spaceRoute);
		const space = await createTestWikiSpace(request, { route: spaceRoute });

		await page.goto(appUrl('spaces', space.name));
		await page.waitForLoadState('networkidle');
		await expect(page.locator('aside')).toBeVisible();

		// Open the create dialog — empty-space CTA or the Add dropdown.
		await openNewPageDialog(page);

		const titleInput = page.getByLabel('Title');
		await expect(titleInput).toBeVisible({ timeout: 5000 });
		const pageTitle = `Test Page ${Date.now()}`;
		await titleInput.fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Let the optimistic create finish syncing before opening it: while the
		// node is pending its "Saving…" badge shows, and its draft page isn't
		// backed yet, so the editor can't mount. Wait for that to clear, then open.
		const pageItem = page
			.locator('aside')
			.getByText(pageTitle, { exact: true });
		await expect(pageItem).toBeVisible({ timeout: 10000 });
		await expect(page.locator('aside').getByTitle('Saving…')).toHaveCount(0, {
			timeout: 15000,
		});
		await pageItem.click();
		await page.waitForURL(/\/draft\/[^/?#]+/, { timeout: 10000 });

		await expect(
			page.locator('.ProseMirror, [contenteditable="true"]'),
		).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(pageTitle).first()).toBeVisible();
	});

	test('should have New Page button in space sidebar', async ({ page }) => {
		// Navigate to wiki and click first space
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Should have sidebar with space management buttons
		await expect(page.locator('aside')).toBeVisible();

		// Wait for the tree to load (CR mode requires async init).
		// On an empty space the empty-state "Create First Page" CTA renders
		// instead of the sidebar Add dropdown — `.or().first()` tolerates
		// either without tripping strict-mode on two matches.
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const addButton = page.locator('button[title="Add"]');
		await expect(createFirstPage.or(addButton).first()).toBeVisible({
			timeout: 10000,
		});
	});

	test('should open wiki editor when clicking page in sidebar', async ({
		page,
	}) => {
		// Navigate to wiki and click first space
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Wait for sidebar to load - either the empty-state CTA or the Add menu
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const addButton = page.locator('button[title="Add"]');
		await expect(createFirstPage.or(addButton).first()).toBeVisible({
			timeout: 10000,
		});

		// Always create a new page so we know exactly what to click
		const pageTitle = `Test Page ${Date.now()}`;
		await openNewPageDialog(page);

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Click the newly created page in the sidebar
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForLoadState('networkidle');

		// Editor should be visible (clicking a page opens it in edit mode)
		await expect(
			page.locator('.ProseMirror, [contenteditable="true"]'),
		).toBeVisible({ timeout: 10000 });

		// Verify save draft button is present (indicates edit mode)
		await expect(page.locator('button:has-text("Save")')).toBeVisible();
	});

	test('should publish page and view it on public route', async ({
		page,
		request,
	}) => {
		// Navigate to wiki and click first space
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create a new page with specific title and content
		const pageTitle = `e2e-cr-page-${Date.now()}`;
		const pageContent = `This is test content created by E2E tests at ${new Date().toISOString()}`;

		// Click create button (either "Create First Page" or "New Page")
		await openNewPageDialog(page);

		// Fill in page title
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the newly created page from the tree
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
		expect(draftMatch).toBeTruthy();
		const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

		// Wait for editor to be visible
		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Clear default content and add our test content
		await editor.click();
		await page.keyboard.press('Meta+a'); // Select all
		await page.keyboard.type(pageContent);

		// Save the draft
		await page.click('button:has-text("Save")');
		await page.waitForLoadState('networkidle');

		// Submit for review and merge
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, {
			timeout: 10000,
		});
		await publishChangeRequestFromReview(page);

		// Verify the public page shows the content we added
		const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		expect(routes.length).toBe(1);
		await page.goto(`/${routes[0].route}`);
		await page.waitForLoadState('networkidle');
		await expect(
			page.locator('#wiki-content, .prose').filter({ hasText: pageContent }),
		).toBeVisible({ timeout: 10000 });
	});
});
