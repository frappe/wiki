import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

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
 * Tests that the Table of Contents updates correctly during
 * client-side sidebar navigation (SPA navigation).
 */
test.describe('TOC Navigation', () => {
	test('should update TOC headings when navigating between pages via sidebar', async ({
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

		// Create first page with specific headings
		const firstPageTitle = `toc-nav-first-${Date.now()}`;
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
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

		// Open first page and set content with headings
		await page
			.locator('aside')
			.getByText(firstPageTitle, { exact: true })
			.click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const draftMatch1 = page.url().match(/\/draft\/([^/?#]+)/);
		expect(draftMatch1).toBeTruthy();
		const firstDocKey = decodeURIComponent(draftMatch1?.[1] ?? '');

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const firstPageMarkdown = `## Alpha Section

Alpha content here.

## Beta Section

Beta content here.

### Beta Subsection

Beta sub content.`;

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, firstPageMarkdown);

		await expect(editor.locator('h2:has-text("Alpha Section")')).toBeVisible({
			timeout: 5000,
		});
		await editor.click();
		await page.waitForTimeout(500);

		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		// Create second page with different headings
		const secondPageTitle = `toc-nav-second-${Date.now()}`;
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
		await page.waitForURL(/\/draft\/[^/?#]+/);
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(
			() => window.wikiEditor?.commands?.setContent !== undefined,
			{ timeout: 10000 },
		);
		// Ensure editor is ready to accept content
		await page.waitForTimeout(500);

		const secondPageMarkdown = `## Gamma Section

Gamma content here.

## Delta Section

Delta content here.

### Delta Subsection

Delta sub content.

## Epsilon Section

Epsilon content here.`;

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, secondPageMarkdown);

		await expect(editor.locator('h2:has-text("Gamma Section")')).toBeVisible({
			timeout: 5000,
		});
		await editor.click();
		await page.waitForTimeout(500);

		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		// Submit and merge both pages
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		// Handle both "Merge" and "Resolve & Merge" buttons (conflicts may auto-resolve)
		const mergeButton = page.getByRole('button', { name: /Merge/ });
		await expect(mergeButton).toBeVisible({ timeout: 10000 });
		await mergeButton.click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		// Open public view for the first page
		const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: firstDocKey },
			limit: 1,
		});
		expect(routes.length).toBe(1);

		const publicPage = await page.context().newPage();
		await publicPage.goto(`/${routes[0].route}`);
		await publicPage.waitForLoadState('networkidle');
		await publicPage.setViewportSize({ width: 1100, height: 900 });

		// Verify first page TOC has correct headings
		const tocContainer = publicPage.locator('#wiki-toc');
		await expect(tocContainer).toBeVisible({ timeout: 10000 });

		const tocNav = tocContainer.locator('nav');
		await expect(tocNav.locator('a:has-text("Alpha Section")')).toBeVisible();
		await expect(tocNav.locator('a:has-text("Beta Section")')).toBeVisible();
		await expect(tocNav.locator('a:has-text("Beta Subsection")')).toBeVisible();

		// First page TOC should NOT contain second page headings
		await expect(
			tocNav.locator('a:has-text("Gamma Section")'),
		).not.toBeVisible();
		await expect(
			tocNav.locator('a:has-text("Delta Section")'),
		).not.toBeVisible();

		// Navigate to second page via sidebar
		const sidebar = publicPage.locator('.wiki-sidebar');
		const secondPageLink = sidebar.locator(
			`.wiki-link:has-text("${secondPageTitle}")`,
		);
		await expect(secondPageLink).toBeVisible({ timeout: 5000 });
		await secondPageLink.click();

		// Wait for content to update
		await expect(publicPage.locator('#wiki-page-title')).toHaveText(
			secondPageTitle,
			{ timeout: 10000 },
		);

		// Verify TOC updated to second page headings
		await expect(tocNav.locator('a:has-text("Gamma Section")')).toBeVisible({
			timeout: 5000,
		});
		await expect(tocNav.locator('a:has-text("Delta Section")')).toBeVisible();
		await expect(
			tocNav.locator('a:has-text("Delta Subsection")'),
		).toBeVisible();
		await expect(tocNav.locator('a:has-text("Epsilon Section")')).toBeVisible();

		// First page headings should no longer be in TOC
		await expect(
			tocNav.locator('a:has-text("Alpha Section")'),
		).not.toBeVisible();
		await expect(
			tocNav.locator('a:has-text("Beta Section")'),
		).not.toBeVisible();

		// Navigate back to first page via sidebar
		const firstPageLink = sidebar.locator(
			`.wiki-link:has-text("${firstPageTitle}")`,
		);
		await expect(firstPageLink).toBeVisible({ timeout: 5000 });
		await firstPageLink.click();

		// Wait for content to update back
		await expect(publicPage.locator('#wiki-page-title')).toHaveText(
			firstPageTitle,
			{ timeout: 10000 },
		);

		// Verify TOC reverted to first page headings
		await expect(tocNav.locator('a:has-text("Alpha Section")')).toBeVisible({
			timeout: 5000,
		});
		await expect(tocNav.locator('a:has-text("Beta Section")')).toBeVisible();

		// Second page headings should be gone again
		await expect(
			tocNav.locator('a:has-text("Gamma Section")'),
		).not.toBeVisible();

		await publicPage.close();
	});
});
