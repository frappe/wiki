import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';
import {
	APP_BASE,
	CHANGE_REQUEST_URL_RE,
	spaceLinkSelector,
} from '../helpers/routes';
import {
	openNewPageDialog,
	publishChangeRequestFromReview,
} from '../helpers/wiki';

interface WikiDocument {
	name: string;
	title: string;
	content: string;
	route: string;
	doc_key?: string;
}

test.describe('Link Persistence Tests', () => {
	test('should save links as markdown to the database', async ({
		page,
		request,
	}) => {
		// Navigate to wiki and click first space
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create a new page

		const pageTitle = `link-save-test-${Date.now()}`;

		await openNewPageDialog(page);

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the newly created page from the sidebar tree
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();

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
		await page.click('button[aria-label="Link"]');

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

		// Save the draft
		const saveButton = page.locator('button:has-text("Save")');
		await saveButton.click();
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(3000); // Wait for DB commit

		// Capture the doc_key from URL before submitting
		// URL format: ${APP_BASE}/spaces/{spaceId}/draft/{docKey}
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const url = page.url();
		const draftMatch = url.match(
			new RegExp(`${APP_BASE}/spaces/[^/]+/draft/([^/?#]+)`),
		);
		expect(draftMatch).toBeTruthy();
		const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

		// Submit for review and merge so the content lands on the live doc
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, {
			timeout: 10000,
		});
		await publishChangeRequestFromReview(page);

		// Verify content was saved correctly via API - links should be in markdown format
		// This tests that the renderMarkdown fix is working correctly
		const docs = await getList<WikiDocument>(request, 'Wiki Document', {
			fields: ['name', 'content', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		expect(docs.length).toBe(1);
		const savedDoc = docs[0];
		expect(savedDoc.content).toContain(
			'[Example Website](https://example.com)',
		);
	});
});
