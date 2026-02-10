import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

/**
 * Tests for the wiki editor and admin functionality.
 * For public-facing page tests (TOC, sidebar), see public-pages.spec.ts
 */
test.describe('Wiki Editor', () => {
	test('should display wiki spaces list', async ({ page }) => {
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		// Should be on wiki page, not redirected to login
		await expect(page).not.toHaveURL(/.*login.*/);

		// Should show the spaces list view with at least one space or the empty state
		const spacesContainer = page.locator(
			'[data-testid="wiki-spaces"], .wiki-spaces-list, a[href*="/wiki/spaces/"]',
		);
		await expect(spacesContainer.first()).toBeVisible();
	});

	test('should create a new wiki space via UI', async ({ page }) => {
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		// Click create new space button
		await page.click('button:has-text("New"), button:has-text("Create")');

		// Fill in space details in the dialog
		await page.waitForSelector('[role="dialog"], .modal', { state: 'visible' });

		const spaceName = `Test Space ${Date.now()}`;
		await page.fill('input[type="text"]', spaceName);

		// Submit the form
		await page.click('button:has-text("Create"), button[type="submit"]');

		// Wait for the dialog to close and page to update
		await page.waitForLoadState('networkidle');

		// Verify the space was created: check URL changed and space name visible in heading
		await expect(page).toHaveURL(/\/wiki\/spaces\//, { timeout: 10000 });
		await expect(page.getByRole('heading', { name: spaceName })).toBeVisible();
	});

	test('should navigate to space and create a wiki page', async ({ page }) => {
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		// Click on first available space - fail fast if no spaces exist
		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({
			timeout: 5000,
		});
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Should be in the space detail view with sidebar
		await expect(page.locator('aside')).toBeVisible();

		// Look for add/create page button in sidebar
		const addButton = page
			.locator(
				'button:has-text("Create First Page"), button:has-text("New Page")',
			)
			.first();
		await expect(addButton).toBeVisible({
			timeout: 5000,
		});
		await addButton.click();

		// Fill in the page title dialog
		const titleInput = page.getByLabel('Title');
		await expect(titleInput).toBeVisible({ timeout: 5000 });
		const pageTitle = `Test Page ${Date.now()}`;
		await titleInput.fill(pageTitle);

		// Click Save Draft button in dialog (use role to be more specific)
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save Draft' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the newly created page from the sidebar tree
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();

		// Verify we're now in page editing mode - editor should be visible
		await expect(
			page.locator('.ProseMirror, [contenteditable="true"]'),
		).toBeVisible({ timeout: 10000 });

		// Verify page title is shown
		await expect(page.getByText(pageTitle).first()).toBeVisible();
	});

	test('should have New Page button in space sidebar', async ({ page }) => {
		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Should have sidebar with space management buttons
		await expect(page.locator('aside')).toBeVisible();

		// Wait for the tree to load (CR mode requires async init)
		// Should have either "Create First Page" (empty space) or icon buttons for New Group/Page
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

		// Use a combined locator with sufficient timeout for CR tree loading
		await expect(createFirstPage.or(newPageButton)).toBeVisible({
			timeout: 10000,
		});
	});

	test('should open wiki editor when clicking page in sidebar', async ({
		page,
	}) => {
		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Check if there's an existing page (indicated by "Not Published" badge in tree)
		// or if we need to create one
		const pageTreeRow = page
			.locator('aside')
			.locator('.cursor-pointer')
			.first();
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			// No pages - create one
			await createFirstPage.click();
			const pageTitle = `Test Page ${Date.now()}`;
			await page.getByLabel('Title').fill(pageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');
			await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		} else {
			// Pages exist - click on first tree row
			await pageTreeRow.click();
			await page.waitForLoadState('networkidle');
		}

		// Editor should be visible (clicking a page opens it in edit mode)
		await expect(
			page.locator('.ProseMirror, [contenteditable="true"]'),
		).toBeVisible({ timeout: 10000 });

		// Verify save draft button is present (indicates edit mode)
		await expect(page.locator('button:has-text("Save Draft")')).toBeVisible();
	});

	test('should publish page and view it on public route', async ({
		page,
		request,
	}) => {
		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create a new page with specific title and content
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

		const pageTitle = `e2e-cr-page-${Date.now()}`;
		const pageContent = `This is test content created by E2E tests at ${new Date().toISOString()}`;

		// Click create button (either "Create First Page" or "New Page")
		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		// Fill in page title
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save Draft' })
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
		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');

		// Submit for review and merge
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		await page.getByRole('button', { name: 'Merge' }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

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
