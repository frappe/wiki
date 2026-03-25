import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

/**
 * Tests for the public-facing wiki sidebar.
 * These tests verify that the sidebar correctly displays only published pages
 * and that client-side navigation works properly.
 */
test.describe('Public Sidebar', () => {
	test.describe('Published Pages Visibility', () => {
		test('should only display published pages in the public sidebar', async ({
			page,
			request,
		}) => {
			await page.setViewportSize({ width: 1100, height: 900 });

			// Navigate to wiki and click first space
			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			await expect(spaceLink).toBeVisible({ timeout: 5000 });
			const spaceHref = await spaceLink.getAttribute('href');
			expect(spaceHref).toBeTruthy();
			await spaceLink.click();
			await page.waitForLoadState('networkidle');
			const spaceUrl = spaceHref as string;

			// Create a published page inside the space
			const createFirstPage = page.locator(
				'button:has-text("Create First Page")',
			);
			const newPageButton = page.locator('button[title="New Page"]');

			const publishedPageTitle = `published-page-${Date.now()}`;

			if (
				await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)
			) {
				await createFirstPage.click();
			} else {
				await newPageButton.click();
			}

			await page.getByLabel('Title').fill(publishedPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			// Open the newly created page from the sidebar tree
			await page
				.locator('aside')
				.getByText(publishedPageTitle, { exact: true })
				.click();
			await page.waitForURL(/\/draft\/[^/?#]+/);
			const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
			expect(draftMatch).toBeTruthy();
			const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

			// Wait for editor and add content
			const editor = page.locator('.ProseMirror, [contenteditable="true"]');
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('This is published content.');

			// Save the draft
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			// Submit for review and merge the page
			await page.getByRole('button', { name: 'Submit for Review' }).click();
			await page.getByRole('button', { name: 'Submit' }).click();
			await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
				timeout: 10000,
			});
			await page.getByRole('button', { name: 'Merge' }).click();
			await expect(
				page.locator('text=Change request merged').first(),
			).toBeVisible({ timeout: 15000 });

			// Create an unpublished page
			await page.goto(spaceUrl);
			await page.waitForLoadState('networkidle');

			const unpublishedPageTitle = `unpublished-page-${Date.now()}`;
			const createPageButton = page
				.locator(
					'button:has-text("Create First Page"), button[title="New Page"]',
				)
				.first();
			await expect(createPageButton).toBeVisible({ timeout: 15000 });
			await createPageButton.click();
			await page.getByLabel('Title').fill(unpublishedPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			// Open the newly created draft page and add content (no merge)
			await page
				.locator('aside')
				.getByText(unpublishedPageTitle, { exact: true })
				.click();
			await page.waitForURL(/\/draft\/[^/?#]+/);
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('This is unpublished content.');
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			// Open public page for published content
			const routes = await getList<WikiDocumentRoute>(
				request,
				'Wiki Document',
				{
					fields: ['route', 'doc_key'],
					filters: { doc_key: docKey },
					limit: 1,
				},
			);
			expect(routes.length).toBe(1);
			const publicPage = await page.context().newPage();
			await publicPage.goto(`/${routes[0].route}`);
			await publicPage.waitForLoadState('networkidle');
			await publicPage.setViewportSize({ width: 1100, height: 900 });

			// Verify the sidebar is visible on the public page
			const sidebar = publicPage.locator('.wiki-sidebar');
			await expect(sidebar).toBeVisible({ timeout: 10000 });

			// Verify the published page appears in the sidebar
			const publishedLink = sidebar.locator(
				`.wiki-link:has-text("${publishedPageTitle}")`,
			);
			await expect(publishedLink).toBeVisible({ timeout: 5000 });

			// Verify the unpublished page does NOT appear in the sidebar
			const unpublishedLink = sidebar.locator(
				`.wiki-link:has-text("${unpublishedPageTitle}")`,
			);
			await expect(unpublishedLink).not.toBeVisible();

			await publicPage.close();
		});
	});

	test.describe('Sidebar Navigation', () => {
		test('should use client-side navigation without full page refresh when clicking sidebar links', async ({
			page,
			request,
		}) => {
			await page.setViewportSize({ width: 1100, height: 900 });

			// Navigate to wiki and click first space
			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			await expect(spaceLink).toBeVisible({ timeout: 5000 });
			await spaceLink.click();
			await page.waitForLoadState('networkidle');

			// Create two pages so we can navigate between them
			const firstPageTitle = `spa-nav-first-${Date.now()}`;
			const createFirstPage = page.locator(
				'button:has-text("Create First Page")',
			);
			const newPageButton = page.locator('button[title="New Page"]');

			if (
				await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)
			) {
				await createFirstPage.click();
			} else {
				await newPageButton.click();
			}

			await page.getByLabel('Title').fill(firstPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			await page
				.locator('aside')
				.getByText(firstPageTitle, { exact: true })
				.click();
			await page.waitForURL(/\/draft\/[^/?#]+/);
			const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
			expect(draftMatch).toBeTruthy();
			const firstDocKey = decodeURIComponent(draftMatch?.[1] ?? '');
			const editor = page.locator('.ProseMirror, [contenteditable="true"]');
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('First SPA nav test page.');
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			const secondPageTitle = `spa-nav-second-${Date.now()}`;
			await page.locator('button[title="New Page"]').click();
			await page.getByLabel('Title').fill(secondPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			await page
				.locator('aside')
				.getByText(secondPageTitle, { exact: true })
				.click();
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('Second SPA nav test page.');
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			// Merge both pages
			await page.getByRole('button', { name: 'Submit for Review' }).click();
			await page.getByRole('button', { name: 'Submit' }).click();
			await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
				timeout: 10000,
			});
			await page.getByRole('button', { name: 'Merge' }).click();
			await expect(
				page.locator('text=Change request merged').first(),
			).toBeVisible({ timeout: 15000 });

			// Open first page in public view
			const routes = await getList<WikiDocumentRoute>(
				request,
				'Wiki Document',
				{
					fields: ['route', 'doc_key'],
					filters: { doc_key: firstDocKey },
					limit: 1,
				},
			);
			expect(routes.length).toBe(1);
			const publicPage = await page.context().newPage();
			await publicPage.goto(`/${routes[0].route}`);
			await publicPage.waitForLoadState('networkidle');
			await publicPage.setViewportSize({ width: 1100, height: 900 });

			await expect(publicPage.locator('#wiki-page-title')).toHaveText(
				firstPageTitle,
				{ timeout: 10000 },
			);

			// Set a sentinel on window — a full page refresh will wipe it
			await publicPage.evaluate(() => {
				(
					window as unknown as Record<string, unknown>
				).__spa_nav_sentinel = true;
			});

			// Click the second page in the sidebar
			const sidebar = publicPage.locator('.wiki-sidebar');
			const secondPageLink = sidebar.locator(
				`.wiki-link:has-text("${secondPageTitle}")`,
			);
			await expect(secondPageLink).toBeVisible({ timeout: 5000 });
			await secondPageLink.click();

			// Wait for content to update (SPA navigation)
			await expect(publicPage.locator('#wiki-page-title')).toHaveText(
				secondPageTitle,
				{ timeout: 10000 },
			);

			// The sentinel must still exist — if a full page refresh happened, it's gone
			const sentinelSurvived = await publicPage.evaluate(
				() =>
					(window as unknown as Record<string, unknown>).__spa_nav_sentinel ===
					true,
			);
			expect(sentinelSurvived).toBe(true);

			// Verify URL changed (pushState, not a reload)
			expect(publicPage.url()).not.toContain(routes[0].route);

			await publicPage.close();
		});

		test('should update content, URL, active state, and metadata when clicking sidebar links', async ({
			page,
			request,
		}) => {
			await page.setViewportSize({ width: 1100, height: 900 });

			// Navigate to wiki and click first space
			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			await expect(spaceLink).toBeVisible({ timeout: 5000 });
			await spaceLink.click();
			await page.waitForLoadState('networkidle');
			// Create first page
			const firstPageTitle = `first-nav-page-${Date.now()}`;
			const createFirstPage = page.locator(
				'button:has-text("Create First Page")',
			);
			const newPageButton = page.locator('button[title="New Page"]');

			if (
				await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)
			) {
				await createFirstPage.click();
			} else {
				await newPageButton.click();
			}

			await page.getByLabel('Title').fill(firstPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			// Open and add content to first page
			await page
				.locator('aside')
				.getByText(firstPageTitle, { exact: true })
				.click();
			await page.waitForURL(/\/draft\/[^/?#]+/);
			const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
			expect(draftMatch).toBeTruthy();
			const firstDocKey = decodeURIComponent(draftMatch?.[1] ?? '');
			const editor = page.locator('.ProseMirror, [contenteditable="true"]');
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('First page content here.');
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			// Create second page in the same change request
			const secondPageTitle = `second-nav-page-${Date.now()}`;
			await page.locator('button[title="New Page"]').click();
			await page.getByLabel('Title').fill(secondPageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save Draft' })
				.click();
			await page.waitForLoadState('networkidle');

			// Open and add different content to second page
			await page
				.locator('aside')
				.getByText(secondPageTitle, { exact: true })
				.click();
			await expect(editor).toBeVisible({ timeout: 10000 });
			await editor.click();
			await page.keyboard.type('Second page different content.');
			await page.click('button:has-text("Save Draft")');
			await page.waitForLoadState('networkidle');

			// Submit for review and merge both pages
			await page.getByRole('button', { name: 'Submit for Review' }).click();
			await page.getByRole('button', { name: 'Submit' }).click();
			await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
				timeout: 10000,
			});
			await page.getByRole('button', { name: 'Merge' }).click();
			await expect(
				page.locator('text=Change request merged').first(),
			).toBeVisible({ timeout: 15000 });

			// Open public view for the first page
			const routes = await getList<WikiDocumentRoute>(
				request,
				'Wiki Document',
				{
					fields: ['route', 'doc_key'],
					filters: { doc_key: firstDocKey },
					limit: 1,
				},
			);
			expect(routes.length).toBe(1);
			const publicPage = await page.context().newPage();
			await publicPage.goto(`/${routes[0].route}`);
			await publicPage.waitForLoadState('networkidle');
			await publicPage.setViewportSize({ width: 1100, height: 900 });

			// Verify initial state on first page
			const pageTitle = publicPage.locator('#wiki-page-title');
			await expect(pageTitle).toHaveText(firstPageTitle, { timeout: 10000 });

			const pageContent = publicPage.locator('#wiki-content');
			await expect(pageContent).toContainText('First page content');

			const initialUrl = publicPage.url();

			// Verify first page link is active
			const sidebar = publicPage.locator('.wiki-sidebar');
			const firstPageLink = sidebar.locator(
				`.wiki-link:has-text("${firstPageTitle}")`,
			);
			await expect(firstPageLink).toHaveAttribute('aria-current', 'page', {
				timeout: 5000,
			});

			// Verify last updated timestamp is visible
			const lastUpdated = publicPage.locator('#wiki-last-updated');
			await expect(lastUpdated).toBeVisible();
			await expect(lastUpdated).toContainText('Last updated');

			// Get initial edit link href
			const editLinks = publicPage.locator('.wiki-edit-link, #wiki-edit-link');
			const initialEditHref = await editLinks.first().getAttribute('href');

			// Click the second page link in sidebar
			const secondPageLink = sidebar.locator(
				`.wiki-link:has-text("${secondPageTitle}")`,
			);
			await expect(secondPageLink).toBeVisible({ timeout: 5000 });
			await secondPageLink.click();
			await publicPage.waitForTimeout(500);

			// Verify content updated
			await expect(pageTitle).toHaveText(secondPageTitle, { timeout: 10000 });
			await expect(pageContent).toContainText('Second page different content');

			// Verify URL updated (client-side navigation)
			expect(publicPage.url()).not.toEqual(initialUrl);

			// Verify second page link is now active
			await expect(secondPageLink).toHaveAttribute('aria-current', 'page', {
				timeout: 5000,
			});

			// Verify first page link is no longer active
			const firstPageAriaCurrent =
				await firstPageLink.getAttribute('aria-current');
			expect(firstPageAriaCurrent).not.toBe('page');

			// Verify edit link updated
			const updatedEditHref = await editLinks.first().getAttribute('href');
			expect(updatedEditHref).not.toEqual(initialEditHref);

			// Verify last updated is still visible
			await expect(lastUpdated).toBeVisible();
			await expect(lastUpdated).toContainText('Last updated');

			await publicPage.close();
		});
	});
});
