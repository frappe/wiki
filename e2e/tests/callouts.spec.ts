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
 * Tests for callout rendering on published wiki pages.
 * Verifies callouts with default title, custom title, and no title.
 */
test.describe('Callout Rendering', () => {
	test('should render callouts with default title, custom title, and no title on published page', async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		// Navigate to wiki and open a space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create a new page
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');
		const pageTitle = `callout-test-${Date.now()}`;

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save Draft' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the draft page
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
		expect(draftMatch).toBeTruthy();
		const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

		// Wait for editor
		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Set content with 3 callouts: default title, no title, and custom title
		const markdownContent = `## Callout Examples

:::note
This note has the default title.
:::

:::tip[]
This tip has no title at all.
:::

:::danger[Do Not Delete]
This danger callout has a custom title.
:::`;

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, markdownContent);

		// Verify editor has the heading
		await expect(editor.locator('h2:has-text("Callout Examples")')).toBeVisible(
			{ timeout: 5000 },
		);

		await editor.click();
		await page.waitForTimeout(500);

		// Save, submit, and merge
		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		await page.getByRole('button', { name: 'Merge' }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		// Navigate to published page
		const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		expect(routes.length).toBe(1);
		const publicUrl = `/${routes[0].route}`;

		const publicPage = await page.context().newPage();
		await publicPage.goto(publicUrl);
		await publicPage.waitForLoadState('networkidle');

		const wikiContent = publicPage.locator('#wiki-content');
		await expect(wikiContent).toBeVisible({ timeout: 10000 });

		// 1. Note callout with default title
		const noteCallout = wikiContent.locator('aside.callout-note');
		await expect(noteCallout).toBeVisible();
		await expect(noteCallout.locator('.callout-icon')).toBeVisible();
		await expect(noteCallout.locator('.callout-title')).toHaveText('Note');
		await expect(noteCallout.locator('.callout-content')).toContainText(
			'This note has the default title.',
		);

		// 2. Tip callout without title (empty brackets)
		const tipCallout = wikiContent.locator('aside.callout-tip');
		await expect(tipCallout).toBeVisible();
		await expect(tipCallout.locator('.callout-icon')).toBeVisible();
		// Should NOT have a callout-title element
		await expect(tipCallout.locator('.callout-title')).toHaveCount(0);
		await expect(tipCallout.locator('.callout-content')).toContainText(
			'This tip has no title at all.',
		);

		// 3. Danger callout with custom title
		const dangerCallout = wikiContent.locator('aside.callout-danger');
		await expect(dangerCallout).toBeVisible();
		await expect(dangerCallout.locator('.callout-icon')).toBeVisible();
		await expect(dangerCallout.locator('.callout-title')).toHaveText(
			'Do Not Delete',
		);
		await expect(dangerCallout.locator('.callout-content')).toContainText(
			'This danger callout has a custom title.',
		);

		await publicPage.close();
	});

	test('should remove title via three-dot menu and persist after save', async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		// Navigate to wiki and open a space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create a new page
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');
		const pageTitle = `callout-remove-title-${Date.now()}`;

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save Draft' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the draft page
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
		expect(draftMatch).toBeTruthy();
		const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

		// Wait for editor
		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Insert a note callout with default title
		const markdownContent = `:::note
This callout will have its title removed.
:::`;

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, markdownContent);

		// Wait for the callout to render in the editor
		const calloutWrapper = editor.locator('.callout-block-wrapper').first();
		await expect(calloutWrapper).toBeVisible({ timeout: 5000 });

		// Verify the title is initially visible
		const titleText = calloutWrapper.locator('.callout-title-text');
		await expect(titleText).toContainText('Note');

		// Click the three-dot menu
		await calloutWrapper.hover();
		const menuBtn = calloutWrapper.locator('.callout-menu-btn');
		await expect(menuBtn).toBeVisible();
		await menuBtn.click();

		// Click "Remove Title"
		await page.getByText('Remove Title').click();
		await page.waitForTimeout(300);

		// Title text should now be empty in the editor
		await expect(titleText).toHaveText('');

		// Save, submit, and merge
		await editor.click();
		await page.waitForTimeout(500);
		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		await page.getByRole('button', { name: 'Merge' }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		// Navigate to published page
		const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		expect(routes.length).toBe(1);
		const publicUrl = `/${routes[0].route}`;

		const publicPage = await page.context().newPage();
		await publicPage.goto(publicUrl);
		await publicPage.waitForLoadState('networkidle');

		const wikiContent = publicPage.locator('#wiki-content');
		await expect(wikiContent).toBeVisible({ timeout: 10000 });

		// Callout should have no title on public page
		const callout = wikiContent.locator('aside.callout-note');
		await expect(callout).toBeVisible();
		await expect(callout.locator('.callout-icon')).toBeVisible();
		await expect(callout.locator('.callout-title')).toHaveCount(0);
		await expect(callout.locator('.callout-content')).toContainText(
			'This callout will have its title removed.',
		);

		await publicPage.close();
	});
});
