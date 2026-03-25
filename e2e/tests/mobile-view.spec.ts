import { APIRequestContext, Page, expect, test } from '@playwright/test';
import { callMethod, getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

/**
 * Tests for mobile-specific UI elements and interactions.
 * These tests verify the mobile navigation experience including
 * the mobile header, bottom sheet sidebar, TOC dropdown, and theme toggle.
 */

// Standard mobile viewport (iPhone SE)
const mobileViewport = { width: 375, height: 667 };

/**
 * Helper to create a merged test page and return the public page URL.
 * This ensures tests have a page to work with.
 */
async function createPublishedTestPage(
	page: Page,
	request: APIRequestContext,
	title: string,
	content?: string,
): Promise<string> {
	// Create a dedicated space for this test
	await page.goto('/wiki/spaces');
	await page.waitForLoadState('networkidle');

	const timestamp = Date.now();
	const spaceName = `mobile-view-space-${timestamp}`;
	const spaceRoute = `mobile-view-space-${timestamp}`;

	await page.getByRole('button', { name: 'New Space' }).click();
	await page.waitForSelector('[role="dialog"]', { state: 'visible' });
	await page.getByLabel('Space Name').fill(spaceName);
	await page.getByLabel('Route').fill(spaceRoute);
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Create' })
		.click();
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/\/wiki\/spaces\//);

	// Create a new page
	const createFirstPage = page.locator('button:has-text("Create First Page")');
	const newPageButton = page.locator('button[title="New Page"]');

	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await newPageButton.click();
	}

	await page.getByLabel('Title').fill(title);
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Save Draft' })
		.click();
	await page.waitForLoadState('networkidle');

	// Open the newly created page from the sidebar tree
	await page.locator('aside').getByText(title, { exact: true }).click();
	await page.waitForURL(/\/draft\/[^/?#]+/);
	const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
	if (!draftMatch) {
		throw new Error('Draft doc key not found in URL');
	}
	const docKey = decodeURIComponent(draftMatch[1]);

	// Wait for editor
	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });

	// Add content if provided
	if (content) {
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});
		await page.evaluate((c) => {
			window.wikiEditor.commands.setContent(c, { contentType: 'markdown' });
		}, content);
	} else {
		await editor.click();
		await page.keyboard.type('Test content for mobile view.');
	}

	// Save the draft
	await page.click('button:has-text("Save Draft")');
	await page.waitForLoadState('networkidle');

	// Submit for review and merge the page
	await page.getByRole('button', { name: 'Submit for Review' }).click();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page).toHaveURL(/\/wiki\/change-requests\//, { timeout: 10000 });
	const crMatch = page.url().match(/\/wiki\/change-requests\/([^/?#]+)/);
	if (!crMatch) {
		throw new Error('Change request ID not found in URL');
	}
	const changeRequestId = decodeURIComponent(crMatch[1]);
	await callMethod(
		request,
		'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.merge_change_request',
		{ name: changeRequestId },
	);

	let routes: WikiDocumentRoute[] = [];
	for (let attempt = 0; attempt < 5; attempt++) {
		routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		if (routes.length) break;
		await page.waitForTimeout(500);
	}
	if (!routes.length || !routes[0].route) {
		throw new Error('Public route not found for doc');
	}
	return `/${routes[0].route}`;
}

/** Locator helpers using data-testid attributes */
const tid = (page: Page, id: string) => page.getByTestId(id);

test.describe('Mobile View', () => {
	test.describe('Mobile Header', () => {
		test('should display mobile header on small viewport', async ({
			page,
			request,
		}) => {
			// Create a test page first (at desktop size for admin)
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `mobile-header-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Now switch to mobile and visit the public page
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Mobile nav container should be visible
			const mobileNav = tid(page, 'mobile-nav');
			await expect(mobileNav).toBeVisible();

			// Mobile header should be visible
			const mobileHeader = tid(page, 'mobile-header');
			await expect(mobileHeader).toBeVisible();

			// Nav container should be sticky (check computed style, not class name)
			const position = await mobileNav.evaluate(
				(el) => getComputedStyle(el).position,
			);
			expect(position).toBe('sticky');

			// Desktop sidebar should be hidden on mobile
			const desktopSidebar = page.locator('.wiki-sidebar');
			await expect(desktopSidebar).not.toBeVisible();
		});

		test('should display wiki space name in mobile header', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `mobile-space-name-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile and visit public page
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Space name element should be visible and non-empty
			const spaceName = tid(page, 'mobile-space-name');
			await expect(spaceName).toBeVisible();

			const spaceNameText = await spaceName.textContent();
			expect(spaceNameText?.trim().length).toBeGreaterThan(0);
		});
	});

	test.describe('Bottom Sheet Sidebar', () => {
		test('should open bottom sheet when menu button is clicked', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-open-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile and visit the public page
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Click the menu toggle button
			await tid(page, 'mobile-menu-toggle').click();

			// Bottom sheet should be visible
			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Overlay backdrop should be visible
			const overlay = tid(page, 'mobile-overlay');
			await expect(overlay).toBeVisible();
		});

		test('should close bottom sheet when overlay is clicked', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-overlay-close-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Open the bottom sheet
			await tid(page, 'mobile-menu-toggle').click();

			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Click the overlay to close (click at top of viewport, away from bottom sheet)
			await page.mouse.click(187, 100);

			// Bottom sheet should be hidden
			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should close bottom sheet when close button is clicked', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-close-button-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Open the bottom sheet
			await tid(page, 'mobile-menu-toggle').click();

			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Click the close button inside bottom sheet
			const closeButton = bottomSheet.getByRole('button', {
				name: 'Close sidebar',
			});
			await closeButton.click();

			// Bottom sheet should be hidden
			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should display sidebar navigation in bottom sheet', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-nav-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Open the bottom sheet
			await tid(page, 'mobile-menu-toggle').click();

			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Bottom sheet should contain a nav element with wiki links
			const nav = bottomSheet.locator('nav');
			await expect(nav).toBeVisible();

			// Should have at least one wiki link (the page we just created)
			const targetLink = nav.getByText(pageTitle, { exact: true });
			await expect(targetLink).toBeVisible();
		});

		test('should close bottom sheet when navigation link is clicked', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-nav-click-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Open the bottom sheet
			await tid(page, 'mobile-menu-toggle').click();

			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Click a navigation link
			const nav = bottomSheet.locator('nav');
			const targetLink = nav.getByText(pageTitle, { exact: true });
			await expect(targetLink).toBeVisible();
			await targetLink.click();

			await page.waitForLoadState('networkidle');

			// Bottom sheet should close after navigation
			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should have drag handle for swipe-to-dismiss', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `bottom-sheet-drag-handle-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Open the bottom sheet
			await tid(page, 'mobile-menu-toggle').click();

			const bottomSheet = tid(page, 'mobile-bottom-sheet');
			await expect(bottomSheet).toBeVisible({ timeout: 5000 });

			// Drag handle should be visible
			const dragHandle = tid(page, 'mobile-drag-handle');
			await expect(dragHandle).toBeVisible();
		});
	});

	test.describe('Mobile TOC Dropdown', () => {
		test('should have TOC container in mobile header structure', async ({
			page,
			request,
		}) => {
			// Create a test page with headings at desktop viewport
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `mobile-toc-test-${Date.now()}`;
			const tocContent = `## First Section

Content for first section.

## Second Section

Content for second section.`;

			const publicUrl = await createPublishedTestPage(
				page,
				request,
				pageTitle,
				tocContent,
			);

			// Switch to mobile and visit the public page
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Verify the page has headings rendered in content
			const contentHeadings = page.locator('#wiki-content h2');
			await expect(contentHeadings.first()).toBeVisible({ timeout: 10000 });

			// Verify the mobile header exists
			await expect(tid(page, 'mobile-header')).toBeVisible();

			// The TOC dropdown toggle exists in DOM (may be hidden via x-show)
			const tocToggle = tid(page, 'mobile-toc-toggle');
			await expect(tocToggle).toHaveCount(1);
		});

		test('should render headings with anchor links on mobile', async ({
			page,
			request,
		}) => {
			// Create a test page with headings
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `mobile-headings-test-${Date.now()}`;
			const tocContent = `## Introduction

Intro content.

## Getting Started

Getting started content.`;

			const publicUrl = await createPublishedTestPage(
				page,
				request,
				pageTitle,
				tocContent,
			);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Verify headings are rendered with proper IDs for anchor links
			const introHeading = page.locator('#wiki-content h2#introduction');
			const gettingStartedHeading = page.locator(
				'#wiki-content h2#getting-started',
			);

			await expect(introHeading).toBeVisible({ timeout: 10000 });
			await expect(gettingStartedHeading).toBeVisible();

			// Headings should have anchor links added by JS
			await page.waitForTimeout(500); // Wait for anchor link JS
			const anchorLink = introHeading.locator('a.heading-anchor');
			await expect(anchorLink).toBeVisible();
		});
	});

	test.describe('Theme Toggle', () => {
		test('should have theme toggle button in mobile header', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `theme-toggle-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Theme toggle button should be visible
			const themeToggle = tid(page, 'mobile-theme-toggle');
			await expect(themeToggle).toBeVisible();
		});
	});

	test.describe('Search Button', () => {
		test('should open search when search button is clicked', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `search-button-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Switch to mobile
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Click the search button
			await tid(page, 'mobile-search-button').click();

			// Search modal/dialog should open
			const searchInput = page.locator(
				'[role="dialog"] input, [role="combobox"], input[type="search"], input[placeholder*="Search"]',
			);
			await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Responsive Breakpoints', () => {
		test('should hide mobile header on desktop viewport', async ({
			page,
			request,
		}) => {
			// Create a test page first (at desktop)
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `responsive-breakpoints-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Start at mobile viewport
			await page.setViewportSize(mobileViewport);
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Verify mobile nav is visible on mobile
			const mobileNav = tid(page, 'mobile-nav');
			await expect(mobileNav).toBeVisible();

			// Switch to desktop viewport
			await page.setViewportSize({ width: 1100, height: 900 });
			await page.waitForTimeout(300);

			// Mobile nav should now be hidden
			await expect(mobileNav).not.toBeVisible();

			// Desktop sidebar should be visible
			const desktopSidebar = page.locator('.wiki-sidebar');
			await expect(desktopSidebar).toBeVisible();
		});

		test('should show mobile header on tablet viewport', async ({
			page,
			request,
		}) => {
			// Create a test page first
			await page.setViewportSize({ width: 1100, height: 900 });
			const pageTitle = `tablet-viewport-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(page, request, pageTitle);

			// Tablet viewport (below lg breakpoint of 1024px)
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			// Mobile nav should be visible on tablet (768px < 1024px lg breakpoint)
			const mobileNav = tid(page, 'mobile-nav');
			await expect(mobileNav).toBeVisible();
		});
	});
});

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
