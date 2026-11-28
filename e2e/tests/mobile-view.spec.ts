import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';

const mobileViewport = { width: 375, height: 667 };

/**
 * A published page to read, and its public URL.
 *
 * Seeded through the API rather than authored and merged through the UI. None
 * of these tests are about the authoring flow -- they inspect the public
 * reader's chrome -- and driving a create-and-merge sixteen times over made the
 * file the slowest in the suite and flaky under load.
 */
async function createPublishedTestPage(
	wiki: WikiFactory,
	title: string,
	content = 'Test content for mobile view.',
): Promise<string> {
	const space = await wiki.space({ pages: [{ title, content }] });
	return `/${space.page(title).route}`;
}

async function openOnMobile(page: Page, url: string) {
	await page.setViewportSize(mobileViewport);
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}

async function expectSheetOpen(bottomSheet: Locator) {
	await expect(bottomSheet).toBeVisible({ timeout: 5000 });
	// The sheet slides in and out, and a drag handle read mid-slide is gone by mousedown.
	await expect
		.poll(() =>
			bottomSheet.evaluate(
				(el) => window.innerHeight - el.getBoundingClientRect().bottom,
			),
		)
		.toBe(0);
}

async function openBottomSheet(page: Page) {
	await tid(page, 'mobile-menu-toggle').click();
	const bottomSheet = tid(page, 'mobile-bottom-sheet');
	await expectSheetOpen(bottomSheet);
	return bottomSheet;
}

async function dragHandleDown(page: Page, distance: number) {
	const box = await tid(page, 'mobile-drag-handle').boundingBox();
	if (!box) throw new Error('drag handle has no box');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + distance, { steps: 5 });
	await page.mouse.up();
}

const tid = (page: Page, id: string) => page.getByTestId(id);

test.describe('Mobile View', () => {
	test.describe('Mobile Header', () => {
		test('should display mobile header on small viewport', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`mobile-header-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);

			const mobileNav = tid(page, 'mobile-nav');
			await expect(mobileNav).toBeVisible();
			await expect(tid(page, 'mobile-header')).toBeVisible();

			const position = await mobileNav.evaluate(
				(el) => getComputedStyle(el).position,
			);
			expect(position).toBe('sticky');

			await expect(page.locator('.wiki-sidebar')).not.toBeVisible();
		});

		test('should display wiki space name in mobile header', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`mobile-space-name-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);

			const spaceName = tid(page, 'mobile-space-name');
			await expect(spaceName).toBeVisible();
			expect((await spaceName.textContent())?.trim().length).toBeGreaterThan(0);
		});
	});

	test.describe('Bottom Sheet Sidebar', () => {
		test('should open bottom sheet when menu button is clicked', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`bottom-sheet-open-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);

			await openBottomSheet(page);
			await expect(tid(page, 'mobile-overlay')).toBeVisible();
		});

		test('should close bottom sheet when overlay is clicked', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`bottom-sheet-overlay-close-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			// The overlay sits above the sheet, so click near the top of the viewport.
			await page.mouse.click(187, 100);

			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should close bottom sheet when close button is clicked', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`bottom-sheet-close-button-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			await bottomSheet.getByRole('button', { name: 'Close sidebar' }).click();

			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should display sidebar navigation in bottom sheet', async ({
			page,
			wiki,
		}) => {
			const pageTitle = `bottom-sheet-nav-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(wiki, pageTitle);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			const nav = bottomSheet.locator('nav');
			await expect(nav).toBeVisible();
			await expect(nav.getByText(pageTitle, { exact: true })).toBeVisible();
		});

		test('should close bottom sheet when navigation link is clicked', async ({
			page,
			wiki,
		}) => {
			const pageTitle = `bottom-sheet-nav-click-test-${Date.now()}`;
			const publicUrl = await createPublishedTestPage(wiki, pageTitle);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			await bottomSheet
				.locator('nav')
				.getByText(pageTitle, { exact: true })
				.click();
			await page.waitForLoadState('networkidle');

			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should close bottom sheet when dragged down past the threshold', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`bottom-sheet-drag-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			await dragHandleDown(page, 40);
			await expectSheetOpen(bottomSheet);

			await dragHandleDown(page, 200);
			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});

		test('should close bottom sheet when the drag handle is tapped', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`bottom-sheet-handle-tap-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);
			const bottomSheet = await openBottomSheet(page);

			await tid(page, 'mobile-drag-handle').click();
			await expect(bottomSheet).not.toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Mobile TOC Dropdown', () => {
		test('should jump to a heading picked from the TOC dropdown', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`mobile-toc-test-${Date.now()}`,
				`## First Section

Content for first section.

## Second Section

Content for second section.`,
			);
			await openOnMobile(page, publicUrl);

			await tid(page, 'mobile-toc-toggle').click();
			const tocLink = tid(page, 'mobile-header').getByRole('link', {
				name: 'Second Section',
			});
			await tocLink.click();

			await expect(page).toHaveURL(/#second-section$/);
			await expect(tocLink).not.toBeVisible();
		});

		test('should list the new page headings after sidebar navigation', async ({
			page,
			wiki,
		}) => {
			const space = await wiki.space({
				pages: [
					{ title: 'Toc Nav Start', content: '## Start Heading\n\nStart.' },
					{ title: 'Toc Nav Target', content: '## Target Heading\n\nTarget.' },
				],
			});
			await openOnMobile(page, `/${space.page('Toc Nav Start').route}`);

			const bottomSheet = await openBottomSheet(page);
			await bottomSheet
				.locator('nav')
				.getByText('Toc Nav Target', { exact: true })
				.click();
			await expect(page).toHaveURL(
				new RegExp(`${space.page('Toc Nav Target').route}$`),
			);

			await tid(page, 'mobile-toc-toggle').click();
			const toc = tid(page, 'mobile-header');
			await expect(
				toc.getByRole('link', { name: 'Target Heading' }),
			).toBeVisible();
			await expect(
				toc.getByRole('link', { name: 'Start Heading' }),
			).not.toBeVisible();
		});

		test('should render headings with anchor links on mobile', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`mobile-headings-test-${Date.now()}`,
				`## Introduction

Intro content.

## Getting Started

Getting started content.`,
			);
			await openOnMobile(page, publicUrl);

			const introHeading = page.locator('#wiki-content h2#introduction');
			await expect(introHeading).toBeVisible({ timeout: 10000 });
			await expect(
				page.locator('#wiki-content h2#getting-started'),
			).toBeVisible();
			await expect(introHeading.locator('a.heading-anchor')).toBeVisible();
		});
	});

	test.describe('Theme Toggle', () => {
		test('should switch theme from the mobile header', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`theme-toggle-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);

			const html = page.locator('html');
			const before = await html.getAttribute('data-theme');
			const after = before === 'dark' ? 'light' : 'dark';

			await tid(page, 'mobile-theme-toggle').click();
			await expect(html).toHaveAttribute('data-theme', after);

			await page.reload();
			await expect(html).toHaveAttribute('data-theme', after);
		});
	});

	test.describe('Search Button', () => {
		test('should open search when search button is clicked', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`search-button-test-${Date.now()}`,
			);
			await openOnMobile(page, publicUrl);

			await tid(page, 'mobile-search-button').click();

			const searchInput = page.locator(
				'[role="dialog"] input, [role="combobox"], input[type="search"], input[placeholder*="Search"]',
			);
			await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Responsive Breakpoints', () => {
		test('should swap mobile header for the sidebar at the lg breakpoint', async ({
			page,
			wiki,
		}) => {
			const publicUrl = await createPublishedTestPage(
				wiki,
				`responsive-breakpoints-test-${Date.now()}`,
				'## Section\n\nBody text.',
			);
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.goto(publicUrl);
			await page.waitForLoadState('networkidle');

			const mobileNav = tid(page, 'mobile-nav');
			const sidebar = page.locator('.wiki-sidebar');
			const toc = page.locator('#wiki-toc');
			await expect(mobileNav).toBeVisible();
			await expect(sidebar).not.toBeVisible();
			await expect(toc).not.toBeVisible();

			await page.setViewportSize({ width: 1100, height: 900 });

			await expect(mobileNav).not.toBeVisible();
			await expect(sidebar).toBeVisible();
			await expect(toc).toBeVisible();
		});
	});
});
