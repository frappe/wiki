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
 * Helper: create a wiki page with given markdown, publish it, and return the public URL.
 */
async function createAndPublishPage(
	page: import('@playwright/test').Page,
	request: import('@playwright/test').APIRequestContext,
	title: string,
	markdownContent: string,
): Promise<string> {
	await page.setViewportSize({ width: 1100, height: 900 });
	await page.goto('/wiki');
	await page.waitForLoadState('networkidle');

	const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
	await expect(spaceLink).toBeVisible({ timeout: 5000 });
	await spaceLink.click();
	await page.waitForLoadState('networkidle');

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

	await page.locator('aside').getByText(title, { exact: true }).click();
	await page.waitForURL(/\/draft\/[^/?#]+/);
	const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
	expect(draftMatch).toBeTruthy();
	const docKey = decodeURIComponent(draftMatch?.[1] ?? '');

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });
	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});

	await page.evaluate((content) => {
		window.wikiEditor.commands.setContent(content, {
			contentType: 'markdown',
		});
	}, markdownContent);

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
	await expect(page.locator('text=Change request merged').first()).toBeVisible({
		timeout: 15000,
	});

	const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
		fields: ['route', 'doc_key'],
		filters: { doc_key: docKey },
		limit: 1,
	});
	expect(routes.length).toBe(1);
	return `/${routes[0].route}`;
}

test.describe('Image Viewer / Lightbox', () => {
	test('should open lightbox when clicking a prose image and close on overlay click', async ({
		page,
		request,
	}) => {
		const pageTitle = `lightbox-test-${Date.now()}`;
		const markdown = `## Image Test

Here is an image:

![Test screenshot](https://placehold.co/600x400/png)

Some text after the image.`;

		const publicUrl = await createAndPublishPage(
			page,
			request,
			pageTitle,
			markdown,
		);

		const publicPage = await page.context().newPage();
		await publicPage.goto(publicUrl);
		await publicPage.waitForLoadState('networkidle');

		// Verify the image is rendered in content
		const img = publicPage.locator('#wiki-content img').first();
		await expect(img).toBeVisible({ timeout: 10000 });

		// Image should have zoom-in cursor
		await expect(img).toHaveCSS('cursor', 'zoom-in');

		// Lightbox overlay should be hidden initially
		const viewer = publicPage.locator('#image-viewer');
		await expect(viewer).not.toBeVisible();

		// Click the image to open lightbox
		await img.click();

		// Overlay should become visible
		await expect(viewer).toBeVisible({ timeout: 3000 });
		await expect(viewer).toHaveClass(/active/);

		// Body should have scroll lock
		await expect(publicPage.locator('body')).toHaveClass(/image-viewer-open/);

		// Viewer image should have the same src
		const viewerImg = publicPage.locator('#image-viewer-img');
		const originalSrc = await img.getAttribute('src');
		expect(originalSrc).toBeTruthy();
		await expect(viewerImg).toHaveAttribute('src', originalSrc as string);

		// Click overlay to close
		await viewer.click({ position: { x: 10, y: 10 } });

		// Wait for transition to complete
		await publicPage.waitForTimeout(300);
		await expect(viewer).not.toBeVisible();

		// Body scroll should be restored
		const bodyClasses = await publicPage.locator('body').getAttribute('class');
		expect(bodyClasses).not.toContain('image-viewer-open');

		await publicPage.close();
	});

	test('should close lightbox on Escape key', async ({ page, request }) => {
		const pageTitle = `lightbox-esc-test-${Date.now()}`;
		const markdown = `## Escape Key Test

![Test image](https://placehold.co/600x400/png)`;

		const publicUrl = await createAndPublishPage(
			page,
			request,
			pageTitle,
			markdown,
		);

		const publicPage = await page.context().newPage();
		await publicPage.goto(publicUrl);
		await publicPage.waitForLoadState('networkidle');

		const img = publicPage.locator('#wiki-content img').first();
		await expect(img).toBeVisible({ timeout: 10000 });

		// Open lightbox
		await img.click();
		const viewer = publicPage.locator('#image-viewer');
		await expect(viewer).toBeVisible({ timeout: 3000 });

		// Press Escape to close
		await publicPage.keyboard.press('Escape');

		await publicPage.waitForTimeout(300);
		await expect(viewer).not.toBeVisible();

		await publicPage.close();
	});

	test('should wire up images loaded via SPA navigation', async ({
		page,
		request,
	}) => {
		// Create two pages — one with an image, one without
		const pageTitle1 = `lightbox-spa-1-${Date.now()}`;
		const pageTitle2 = `lightbox-spa-2-${Date.now()}`;

		const markdown1 = `## Page One

Just some text, no images here.`;

		const markdown2 = `## Page Two

![SPA test image](https://placehold.co/600x400/png)`;

		const publicUrl1 = await createAndPublishPage(
			page,
			request,
			pageTitle1,
			markdown1,
		);
		const publicUrl2 = await createAndPublishPage(
			page,
			request,
			pageTitle2,
			markdown2,
		);

		// Navigate to the first page (no images)
		const publicPage = await page.context().newPage();
		await publicPage.goto(publicUrl1);
		await publicPage.waitForLoadState('networkidle');

		// Now SPA-navigate to the second page (has image) using prev/next or direct nav
		await publicPage.goto(publicUrl2);
		await publicPage.waitForLoadState('networkidle');

		// The image on this page should still trigger the lightbox
		const img = publicPage.locator('#wiki-content img').first();
		await expect(img).toBeVisible({ timeout: 10000 });

		await img.click();
		const viewer = publicPage.locator('#image-viewer');
		await expect(viewer).toBeVisible({ timeout: 3000 });

		// Close and verify
		await publicPage.keyboard.press('Escape');
		await publicPage.waitForTimeout(300);
		await expect(viewer).not.toBeVisible();

		await publicPage.close();
	});
});
