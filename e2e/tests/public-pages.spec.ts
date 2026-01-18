import { expect, test } from '@playwright/test';

/**
 * Tests for the public-facing wiki pages.
 * These tests verify the reader experience on published wiki pages,
 * including layout components like sidebar and table of contents.
 */
test.describe('Public Wiki Pages', () => {
	test.describe('Table of Contents', () => {
		test('should render TOC with correct headings on published page', async ({
			page,
		}) => {
			// Use wider viewport to see TOC (lg breakpoint = 1024px)
			await page.setViewportSize({ width: 1100, height: 900 });

			// Navigate to wiki and click first space
			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			await expect(spaceLink).toBeVisible({ timeout: 5000 });
			await spaceLink.click();
			await page.waitForLoadState('networkidle');

			// Create a new page with multiple headings
			const createFirstPage = page.locator(
				'button:has-text("Create First Page")',
			);
			const newPageButton = page.locator('button[title="New Page"]');

			const pageTitle = `TOC Test Page ${Date.now()}`;

			// Click create button
			if (
				await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)
			) {
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

			// Type content with multiple headings (h2 and h3)
			await editor.click();
			await page.keyboard.press('Meta+a');

			const contentWithHeadings = `## Introduction

This is the introduction section.

## Getting Started

Learn how to get started with this feature.

### Prerequisites

Before you begin, make sure you have:
- Item 1
- Item 2

### Installation

Follow these steps to install.

## Advanced Usage

This section covers advanced topics.

## Conclusion

That's all for this guide.`;

			await page.keyboard.type(contentWithHeadings);

			// Save the page
			await page.click('button:has-text("Save")');
			await page.waitForLoadState('networkidle');

			// Publish the page via dropdown menu
			await page
				.locator(
					'button:has-text("Save") ~ button, button:has-text("Save") + * button',
				)
				.first()
				.click();

			await page.waitForSelector('[role="menuitem"], [role="option"]', {
				state: 'visible',
				timeout: 5000,
			});
			await page.getByRole('menuitem', { name: 'Publish' }).click();
			await page.waitForLoadState('networkidle');

			// Wait for "Published" badge
			await expect(page.locator('text=Published').first()).toBeVisible({
				timeout: 10000,
			});

			// Click "View Page" to open public page
			const viewPageButton = page.locator('button:has-text("View Page")');
			await expect(viewPageButton).toBeVisible({ timeout: 5000 });

			const [publicPage] = await Promise.all([
				page.context().waitForEvent('page'),
				viewPageButton.click(),
			]);

			// Set viewport on new page too (lg breakpoint = 1024px)
			await publicPage.setViewportSize({ width: 1100, height: 900 });
			await publicPage.waitForLoadState('networkidle');

			// Verify the TOC aside is visible (only visible on lg+ screens)
			const tocAside = publicPage.locator('aside').filter({
				has: publicPage.locator('text=On this page'),
			});
			await expect(tocAside).toBeVisible({ timeout: 10000 });

			// Verify TOC contains the expected headings
			const tocNav = tocAside.locator('nav');
			await expect(tocNav.locator('a:has-text("Introduction")')).toBeVisible();
			await expect(
				tocNav.locator('a:has-text("Getting Started")'),
			).toBeVisible();
			await expect(
				tocNav.locator('a:has-text("Advanced Usage")'),
			).toBeVisible();
			await expect(tocNav.locator('a:has-text("Conclusion")')).toBeVisible();

			// h3 headings should also be in TOC
			await expect(tocNav.locator('a:has-text("Prerequisites")')).toBeVisible();
			await expect(tocNav.locator('a:has-text("Installation")')).toBeVisible();

			// Verify clicking a TOC link scrolls to the heading
			await tocNav.locator('a:has-text("Advanced Usage")').click();
			await publicPage.waitForTimeout(500);

			const advancedHeading = publicPage
				.locator('h2')
				.filter({ hasText: 'Advanced Usage' });
			await expect(advancedHeading).toBeInViewport();

			await publicPage.close();
		});

		test('should hide TOC on mobile viewport', async ({ page }) => {
			// Navigate to an existing published page at mobile viewport
			await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			if (await spaceLink.isVisible({ timeout: 3000 }).catch(() => false)) {
				await spaceLink.click();
				await page.waitForLoadState('networkidle');

				// Try to find a published page link in sidebar
				const pageLink = page.locator('aside a[href^="/"]').first();
				if (await pageLink.isVisible({ timeout: 3000 }).catch(() => false)) {
					const href = await pageLink.getAttribute('href');
					if (href) {
						// Navigate to the public page directly
						await page.goto(href);
						await page.waitForLoadState('networkidle');

						// TOC aside should NOT be visible on mobile
						const tocAside = page.locator('aside').filter({
							has: page.locator('text=On this page'),
						});

						// Should be hidden (lg:block means hidden below lg)
						await expect(tocAside).not.toBeVisible();
					}
				}
			}
		});
	});

	test.describe('Sidebar', () => {
		test('should show sidebar on desktop viewport', async ({ page }) => {
			await page.setViewportSize({ width: 1100, height: 900 });

			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			if (await spaceLink.isVisible({ timeout: 3000 }).catch(() => false)) {
				await spaceLink.click();
				await page.waitForLoadState('networkidle');

				// Find a published page and navigate to it
				const pageLink = page.locator('aside a[href^="/"]').first();
				if (await pageLink.isVisible({ timeout: 3000 }).catch(() => false)) {
					const href = await pageLink.getAttribute('href');
					if (href) {
						await page.goto(href);
						await page.waitForLoadState('networkidle');

						// Sidebar should be visible on desktop
						const sidebar = page.locator('.wiki-sidebar, aside nav').first();
						await expect(sidebar).toBeVisible();
					}
				}
			}
		});

		test('should hide sidebar on mobile viewport', async ({ page }) => {
			await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

			await page.goto('/wiki');
			await page.waitForLoadState('networkidle');

			const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
			if (await spaceLink.isVisible({ timeout: 3000 }).catch(() => false)) {
				await spaceLink.click();
				await page.waitForLoadState('networkidle');

				const pageLink = page.locator('aside a[href^="/"]').first();
				if (await pageLink.isVisible({ timeout: 3000 }).catch(() => false)) {
					const href = await pageLink.getAttribute('href');
					if (href) {
						await page.goto(href);
						await page.waitForLoadState('networkidle');

						// Desktop sidebar should be hidden on mobile
						const desktopSidebar = page.locator('.wiki-sidebar');
						await expect(desktopSidebar).not.toBeVisible();
					}
				}
			}
		});
	});
});
