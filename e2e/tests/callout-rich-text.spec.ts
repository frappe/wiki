import { expect, test } from '@playwright/test';

test.describe('Callout Rich Text Editing', () => {
	/**
	 * Helper: navigate to a space and create a new page, returning the editor locator.
	 */
	async function createPageAndOpenEditor(
		page: import('@playwright/test').Page,
		pageTitle: string,
	) {
		await page.goto('/wiki');
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		const newPageButton = page.locator('button[title="New Page"]');

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

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');
		await expect(editor).toBeVisible({ timeout: 10000 });
		return editor;
	}

	test('callout should round-trip inline markdown (bold, italic, links)', async ({
		page,
	}) => {
		const pageTitle = `callout-rt-${Date.now()}`;
		await createPageAndOpenEditor(page, pageTitle);

		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: {
						setContent: (c: string, o?: object) => void;
					};
					getMarkdown: () => string;
					getHTML: () => string;
					getJSON: () => {
						type: string;
						content: { type: string; attrs?: Record<string, unknown> }[];
					};
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			// Set content with a callout using markdown syntax
			const calloutContent =
				'This has **bold** and *italic* and [a link](https://example.com)';
			editor.commands.setContent(`:::note[Test]\n${calloutContent}\n:::`, {
				contentType: 'markdown',
			});

			const md1 = editor.getMarkdown();

			// Round-trip: parse the output back
			editor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = editor.getMarkdown();
			const json = editor.getJSON();

			// Find the callout block in the JSON
			const calloutNode = json.content?.find(
				(n: { type: string }) => n.type === 'calloutBlock',
			);

			return {
				md1,
				md2,
				roundTrip: md1 === md2,
				calloutContent: calloutNode?.attrs?.content,
				hasCallout: !!calloutNode,
			};
		});

		expect(result).not.toHaveProperty('error');
		expect(result.hasCallout).toBe(true);

		// Content should preserve inline markdown
		expect(result.calloutContent).toContain('**bold**');
		expect(result.calloutContent).toContain('*italic*');
		expect(result.calloutContent).toContain('[a link](https://example.com)');

		// Round-trip should be stable
		expect(result.roundTrip).toBe(true);
	});

	test('callout view mode should render formatted HTML preview', async ({
		page,
	}) => {
		const pageTitle = `callout-preview-${Date.now()}`;
		await createPageAndOpenEditor(page, pageTitle);

		// Set content with a callout using markdown syntax
		await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
				};
			};
			ed?.editor?.commands.setContent(
				':::tip\nUse **bold** for emphasis and *italic* for style\n:::',
				{ contentType: 'markdown' },
			);
		});

		// The callout should render in view mode (not editing) with formatted text
		const calloutContent = page.locator(
			'.callout-block-wrapper .callout-content-text',
		);
		await expect(calloutContent).toBeVisible({ timeout: 5000 });

		// Check that bold and italic are rendered as HTML
		const html = await calloutContent.innerHTML();
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	test('callout sub-editor should appear on double-click', async ({ page }) => {
		const pageTitle = `callout-edit-${Date.now()}`;
		await createPageAndOpenEditor(page, pageTitle);

		// Set content with a callout using markdown syntax
		await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
				};
			};
			ed?.editor?.commands.setContent(':::note\nSome content here\n:::', {
				contentType: 'markdown',
			});
		});

		// Double-click the callout content area to enter edit mode
		const calloutContent = page
			.locator('.callout-block-wrapper .callout-content-text')
			.first();
		await expect(calloutContent).toBeVisible({ timeout: 5000 });
		await calloutContent.dblclick();

		// The sub-editor (a nested ProseMirror instance) and toolbar should appear
		const subEditor = page.locator(
			'.callout-block-wrapper .callout-sub-editor-content',
		);
		await expect(subEditor).toBeVisible({ timeout: 5000 });

		// Toolbar buttons (B, I, Link) should be visible
		const toolbar = page.locator(
			'.callout-block-wrapper .flex.items-center.gap-0\\.5',
		);
		await expect(toolbar).toBeVisible();
	});
});
