import { expect, test } from '@playwright/test';
import { publishChangeRequestFromReview } from '../helpers/wiki';

/**
 * Tests for the external link feature in wiki.
 * These tests verify that external links can be created, displayed with the correct icon,
 * and work properly when clicked.
 */
test.describe('External Links', () => {
	test('should create an external link and verify it appears with link icon', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Click the External Link button in the toolbar
		const externalLinkButton = page.locator('button[title="External Link"]');
		await expect(externalLinkButton).toBeVisible({ timeout: 5000 });
		await externalLinkButton.click();

		// Fill in the external link dialog
		const externalLinkTitle = `external-link-${Date.now()}`;
		const externalLinkUrl = 'https://example.com';

		await page.getByLabel('Title').fill(externalLinkTitle);
		await page.getByLabel('URL').fill(externalLinkUrl);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Verify the external link appears in the sidebar
		const sidebarItem = page
			.locator('aside')
			.getByText(externalLinkTitle, { exact: true });
		await expect(sidebarItem).toBeVisible({ timeout: 5000 });

		// Verify it shows the "New" badge indicating it's a draft
		const newBadge = page.locator('aside').getByText('New').first();
		await expect(newBadge).toBeVisible();
	});

	test('should show external link with link icon after merge and open edit dialog on click', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		const spaceHref = await spaceLink.getAttribute('href');
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create an external link
		const externalLinkButton = page.locator('button[title="External Link"]');
		await expect(externalLinkButton).toBeVisible({ timeout: 5000 });
		await externalLinkButton.click();

		const externalLinkTitle = `merged-external-link-${Date.now()}`;
		const externalLinkUrl = 'https://frappe.io/docs';

		await page.getByLabel('Title').fill(externalLinkTitle);
		await page.getByLabel('URL').fill(externalLinkUrl);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Submit for review and merge
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		await publishChangeRequestFromReview(page);

		// Navigate back to space to verify the external link is in the tree after merge
		if (spaceHref) {
			await page.goto(spaceHref);
		}
		await page.waitForLoadState('networkidle');

		// Verify the external link appears in the sidebar after merge
		const sidebarItem = page
			.locator('aside')
			.getByText(externalLinkTitle, { exact: true });
		await expect(sidebarItem).toBeVisible({ timeout: 5000 });

		// Verify the "New" badge is NOT present (it's been merged)
		const itemRow = sidebarItem.locator('..');
		const newBadge = itemRow.getByText('New');
		await expect(newBadge).not.toBeVisible();

		// Click on the external link - should open edit dialog, not navigate
		await sidebarItem.click();

		// Verify the edit dialog appears
		const editDialog = page.getByRole('dialog');
		await expect(editDialog).toBeVisible({ timeout: 5000 });

		// Verify the dialog title is "Edit External Link"
		const dialogTitle = editDialog.getByText('Edit External Link');
		await expect(dialogTitle).toBeVisible();

		// Verify the URL field contains the external URL
		const urlInput = editDialog.getByLabel('URL');
		await expect(urlInput).toHaveValue(externalLinkUrl);

		// Close the dialog
		await editDialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(editDialog).not.toBeVisible();
	});

	test('should show external link in public sidebar with link icon', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		// Navigate to wiki and click first space
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		const spaceHref = await spaceLink.getAttribute('href');
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		// Create an external link
		const externalLinkButton = page.locator('button[title="External Link"]');
		await expect(externalLinkButton).toBeVisible({ timeout: 5000 });
		await externalLinkButton.click();

		const externalLinkTitle = `public-external-link-${Date.now()}`;
		const externalLinkUrl = 'https://docs.frappe.io';

		await page.getByLabel('Title').fill(externalLinkTitle);
		await page.getByLabel('URL').fill(externalLinkUrl);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Also create a regular page so we can access the public view
		const newPageButton = page.locator('button[title="New Page"]');
		await newPageButton.click();

		const pageTitle = `test-page-${Date.now()}`;
		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Open the page and add content
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		await editor.click();
		await page.keyboard.type('Test page content.');
		await page.click('button:has-text("Save")');
		await page.waitForLoadState('networkidle');

		// Submit and merge both items
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});
		await publishChangeRequestFromReview(page);

		// Navigate back to space and click on the page to get public view
		if (spaceHref) {
			await page.goto(spaceHref);
		}
		await page.waitForLoadState('networkidle');

		// Click on the page
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForLoadState('networkidle');

		// Now open the public view
		const viewPublicButton = page.locator('a:has-text("View public page")');
		if (
			await viewPublicButton.isVisible({ timeout: 2000 }).catch(() => false)
		) {
			const publicHref = await viewPublicButton.getAttribute('href');
			if (!publicHref) return;
			const publicPage = await page.context().newPage();
			await publicPage.goto(publicHref);
			await publicPage.waitForLoadState('networkidle');
			await publicPage.setViewportSize({ width: 1100, height: 900 });

			// Verify the sidebar is visible on the public page
			const sidebar = publicPage.locator('.wiki-sidebar');
			await expect(sidebar).toBeVisible({ timeout: 10000 });

			// Verify the external link appears in the public sidebar
			const publicExternalLink = sidebar.getByText(externalLinkTitle, {
				exact: true,
			});
			await expect(publicExternalLink).toBeVisible({ timeout: 5000 });

			// Verify clicking on the external link opens the URL (has target="_blank")
			const linkElement = publicExternalLink.locator('..');
			const targetAttr = await linkElement.getAttribute('target');
			expect(targetAttr).toBe('_blank');

			// Verify the href is the external URL
			const hrefAttr = await linkElement.getAttribute('href');
			expect(hrefAttr).toBe(externalLinkUrl);

			await publicPage.close();
		}
	});
});
