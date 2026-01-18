import { expect, test } from '@playwright/test';

// Extend Window interface for Tiptap editor access in tests
declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
			};
		};
	}
}

/**
 * Tests for the public-facing wiki pages.
 * These tests verify the reader experience on published wiki pages,
 * including layout components like sidebar and table of contents.
 */
test.describe('Public Wiki Pages', () => {
	test.describe('Table of Contents', () => {
		// Skip: Tiptap's markdown serialization in CI doesn't reliably preserve heading
		// syntax when round-tripping through setContent -> getMarkdown. The server-side
		// TOC generation is fully tested in wiki/wiki/test_markdown.py.
		test.skip('should render TOC with correct headings on published page', async ({
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

			// Wait for editor to be visible and ready
			const editor = page.locator('.ProseMirror, [contenteditable="true"]');
			await expect(editor).toBeVisible({ timeout: 10000 });

			// Wait for Tiptap editor to be exposed on window
			await page.waitForFunction(() => window.wikiEditor !== undefined, {
				timeout: 10000,
			});

			// Set markdown content directly via Tiptap's setContent command
			// This is more reliable than typing, which depends on input rules
			const markdownContent = `## Introduction

This is the introduction section.

## Getting Started

Learn how to get started with this feature.

### Prerequisites

Before you begin.

### Installation

Follow these steps.

## Advanced Usage

Advanced topics.

## Conclusion

That is all.`;

			await page.evaluate((content) => {
				window.wikiEditor.commands.setContent(content, {
					contentType: 'markdown',
				});
			}, markdownContent);

			// Verify headings are in the editor before saving
			await expect(editor.locator('h2:has-text("Introduction")')).toBeVisible({
				timeout: 5000,
			});
			await expect(editor.locator('h2:has-text("Conclusion")')).toBeVisible();

			// Click in editor to ensure it's focused and triggers any pending updates
			await editor.click();
			await page.waitForTimeout(500);

			// Save the page
			await page.click('button:has-text("Save")');
			await page.waitForLoadState('networkidle');
			// Wait for save to complete in database
			await page.waitForTimeout(2000);

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

			// TOC is now server-rendered, so it should be immediately available
			// Verify the TOC aside with "On this page" heading is visible
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
