import { expect, test } from '@playwright/test';
import { getDoc } from '../helpers/frappe';

interface WikiDocument {
	name: string;
	title: string;
	content: string;
	route: string;
}

test.describe('Link Persistence Tests', () => {
	test('should save links as markdown to the database', async ({
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

		// Create a new page
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

		const pageTitle = `Link Save Test ${Date.now()}`;

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Clear and type content
		await editor.click();
		await page.keyboard.press('Meta+a');
		await page.keyboard.type('Visit ');
		await page.keyboard.type('Example Website');

		// Wait for text to be fully inserted
		await page.waitForTimeout(500);

		// Select "Example Website" text
		await page.keyboard.press('End');
		for (let i = 0; i < 'Example Website'.length; i++) {
			await page.keyboard.press('Shift+ArrowLeft');
		}
		await page.waitForTimeout(300);

		// Use toolbar button to add link
		await page.click('button[title="Insert Link"]');

		// Wait for link popup input
		const linkInput = page.getByPlaceholder('https://example.com');
		await expect(linkInput).toBeVisible({ timeout: 5000 });
		await linkInput.fill('https://example.com');
		await page.click('button[title="Submit"]');
		await page.waitForTimeout(500);

		// Verify link is visible in editor before save
		const editorLink = editor.locator('a[href="https://example.com"]');
		await expect(editorLink).toBeVisible({ timeout: 5000 });
		await expect(editorLink).toHaveText('Example Website');

		// Save the page
		const saveButton = page.locator('button:has-text("Save")');
		await saveButton.click();
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(3000); // Wait for DB commit

		// Get the page ID from URL to verify content via API
		// URL format: /wiki/spaces/{spaceId}/page/{pageId}
		const url = page.url();
		const pageIdMatch = url.match(/\/wiki\/spaces\/[^/]+\/page\/([^/?#]+)/);
		expect(pageIdMatch).toBeTruthy();
		const pageId = decodeURIComponent(pageIdMatch?.[1] ?? '');

		// Verify content was saved correctly via API - links should be in markdown format
		// This tests that the renderMarkdown fix is working correctly
		const savedDoc = await getDoc<WikiDocument>(
			request,
			'Wiki Document',
			pageId,
		);
		expect(savedDoc.content).toContain(
			'[Example Website](https://example.com)',
		);
	});
});
