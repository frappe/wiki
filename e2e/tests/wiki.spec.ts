import { expect, test } from '@playwright/test';

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

		// Click Create button in dialog (use role to be more specific)
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');

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

		// Should have either "Create First Page" (empty space) or icon buttons for New Group/Page
		// The "New Page" button has title="New Page" and icon="file-plus"
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

		const hasCreateFirst = await createFirstPage
			.isVisible({ timeout: 2000 })
			.catch(() => false);
		const hasNewPage = await newPageButton
			.isVisible({ timeout: 2000 })
			.catch(() => false);

		expect(hasCreateFirst || hasNewPage).toBe(true);
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
			await page.getByLabel('Title').fill(`Test Page ${Date.now()}`);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Create' })
				.click();
			await page.waitForLoadState('networkidle');
		} else {
			// Pages exist - click on first tree row
			await pageTreeRow.click();
			await page.waitForLoadState('networkidle');
		}

		// Editor should be visible (clicking a page opens it in edit mode)
		await expect(
			page.locator('.ProseMirror, [contenteditable="true"]'),
		).toBeVisible({ timeout: 10000 });

		// Verify save button is present (indicates edit mode)
		await expect(page.locator('button:has-text("Save")')).toBeVisible();
	});

	test('should publish page and view it on public route', async ({ page }) => {
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

		const pageTitle = `E2E Test Page ${Date.now()}`;
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
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');

		// Wait for editor to be visible
		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Clear default content and add our test content
		await editor.click();
		await page.keyboard.press('Meta+a'); // Select all
		await page.keyboard.type(pageContent);

		// Save the page
		await page.click('button:has-text("Save")');
		await page.waitForLoadState('networkidle');

		// Publish the page via dropdown menu
		// The menu button is next to the Save button (has MoreVertical icon)
		const menuButton = page.locator('button:has(svg)').filter({
			has: page.locator(
				'[class*="lucide-more-vertical"], [data-lucide="more-vertical"]',
			),
		});

		// Fallback: find the dropdown button near Save
		const dropdownButton = page
			.locator('button')
			.filter({
				hasText: '',
			})
			.last();

		// Click the menu/dropdown button
		if (await menuButton.isVisible({ timeout: 1000 }).catch(() => false)) {
			await menuButton.click();
		} else {
			// Find button after Save that opens dropdown
			await page
				.locator(
					'button:has-text("Save") ~ button, button:has-text("Save") + * button',
				)
				.first()
				.click();
		}

		// Click Publish in the dropdown menu
		await page.waitForSelector('[role="menuitem"], [role="option"]', {
			state: 'visible',
			timeout: 5000,
		});
		// Use role menuitem to avoid matching "Not Published" badges
		await page.getByRole('menuitem', { name: 'Publish' }).click();
		await page.waitForLoadState('networkidle');

		// Wait for "Published" badge to appear (replacing "Not Published")
		await expect(page.locator('text=Published').first()).toBeVisible({
			timeout: 10000,
		});

		// Click "View Page" button to open public page
		const viewPageButton = page.locator('button:has-text("View Page")');
		await expect(viewPageButton).toBeVisible({ timeout: 5000 });

		// Click View Page - it opens in new tab, so we'll handle the popup
		const [newPage] = await Promise.all([
			page.context().waitForEvent('page'),
			viewPageButton.click(),
		]);

		// Wait for the new page to load
		await newPage.waitForLoadState('networkidle');

		// Verify the public page shows the correct title
		await expect(
			newPage.locator('#wiki-page-title, h1').filter({ hasText: pageTitle }),
		).toBeVisible({ timeout: 10000 });

		// Verify the public page shows the content we added
		await expect(
			newPage.locator('#wiki-content, .prose').filter({ hasText: pageContent }),
		).toBeVisible({ timeout: 10000 });

		// Close the new tab
		await newPage.close();
	});
});
