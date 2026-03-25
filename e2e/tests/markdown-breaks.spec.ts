import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';

interface WikiDocument {
	name: string;
	title: string;
	content: string;
	route: string;
	doc_key?: string;
}

test.describe('Markdown Line Breaks', () => {
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

	test('editor should round-trip single line breaks (soft breaks)', async ({
		page,
	}) => {
		const pageTitle = `md-breaks-soft-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		// Use the Tiptap editor API to set markdown content with single newlines
		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			const input = 'Line 1\nLine 2\nLine 3';
			editor.commands.setContent(input, { contentType: 'markdown' });
			const md1 = editor.getMarkdown();

			// Round-trip: parse the output back
			editor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = editor.getMarkdown();
			const html = editor.getHTML();

			return { input, md1, md2, html, roundTrip: md1 === md2 };
		});

		expect(result).not.toHaveProperty('error');
		// Single newlines should produce hard breaks (<br>) within the same paragraph
		expect(result.html).toContain('<br>');
		expect(result.html).toMatch(
			/<p>.*Line 1.*<br>.*Line 2.*<br>.*Line 3.*<\/p>/,
		);
		// Round-trip should be stable
		expect(result.roundTrip).toBe(true);
	});

	test('editor should round-trip consecutive blank lines', async ({ page }) => {
		const pageTitle = `md-breaks-blank-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			// 4 newlines = Hello paragraph + 1 empty paragraph + bye paragraph
			const input = 'Hello\n\n\n\nbye';
			editor.commands.setContent(input, { contentType: 'markdown' });
			const md1 = editor.getMarkdown();

			// Round-trip
			editor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = editor.getMarkdown();
			const html = editor.getHTML();

			return { input, md1, md2, html, roundTrip: md1 === md2 };
		});

		expect(result).not.toHaveProperty('error');
		// Should have 3 paragraphs: Hello, empty, bye
		expect(result.html).toBe('<p>Hello</p><p></p><p>bye</p>');
		// Markdown should preserve the 4 newlines
		expect(result.md1).toBe('Hello\n\n\n\nbye');
		expect(result.roundTrip).toBe(true);
	});

	test('editor should round-trip multiple consecutive blank lines', async ({
		page,
	}) => {
		const pageTitle = `md-breaks-multi-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			// 6 newlines = Hello paragraph + 2 empty paragraphs + bye paragraph
			const input = 'Hello\n\n\n\n\n\nbye';
			editor.commands.setContent(input, { contentType: 'markdown' });
			const md1 = editor.getMarkdown();

			editor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = editor.getMarkdown();
			const html = editor.getHTML();

			return { input, md1, md2, html, roundTrip: md1 === md2 };
		});

		expect(result).not.toHaveProperty('error');
		expect(result.html).toBe('<p>Hello</p><p></p><p></p><p>bye</p>');
		expect(result.md1).toBe('Hello\n\n\n\n\n\nbye');
		expect(result.roundTrip).toBe(true);
	});

	test('editor should round-trip mixed content: headings, breaks, and soft breaks', async ({
		page,
	}) => {
		const pageTitle = `md-breaks-mixed-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			const input =
				'# Title\n\nParagraph 1\n\n\n\nParagraph 2\n\nLine A\nLine B\n\n\n\n\n\nEnd';
			editor.commands.setContent(input, { contentType: 'markdown' });
			const md1 = editor.getMarkdown();

			editor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = editor.getMarkdown();

			return { input, md1, md2, roundTrip: md1 === md2 };
		});

		expect(result).not.toHaveProperty('error');
		// Headings, normal paragraphs, blank lines, and soft breaks should all survive
		expect(result.md1).toContain('# Title');
		expect(result.md1).toContain('Paragraph 1\n\n\n\nParagraph 2');
		expect(result.md1).toMatch(/Line A {2}\nLine B/);
		expect(result.md1).toContain('\n\n\n\n\n\nEnd');
		expect(result.roundTrip).toBe(true);
	});

	test('standard paragraph breaks should not create empty paragraphs', async ({
		page,
	}) => {
		const pageTitle = `md-breaks-standard-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };

			// Normal double newline = standard paragraph break, no empty paragraphs
			const input = 'Hello\n\nbye';
			editor.commands.setContent(input, { contentType: 'markdown' });
			const md1 = editor.getMarkdown();
			const html = editor.getHTML();

			return { md1, html };
		});

		expect(result).not.toHaveProperty('error');
		expect(result.html).toBe('<p>Hello</p><p>bye</p>');
		expect(result.md1).toBe('Hello\n\nbye');
	});

	test('blank lines should persist through save and reload', async ({
		page,
	}) => {
		const pageTitle = `md-breaks-persist-${Date.now()}`;
		const editor = await createPageAndOpenEditor(page, pageTitle);

		const inputMarkdown =
			'First paragraph\n\n\n\nSecond paragraph\n\nLine A\nLine B';

		// Set content with blank lines via the editor API
		await page.evaluate((md) => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			ed?.editor?.commands.setContent(md, { contentType: 'markdown' });
		}, inputMarkdown);

		// Save the draft
		await page.click('button:has-text("Save Draft")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		// Reload the page to force a fresh load from the server
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForTimeout(2000);

		// The editor should reload with the saved content
		const editorAfterReload = page.locator(
			'.ProseMirror, [contenteditable="true"]',
		);
		await expect(editorAfterReload).toBeVisible({ timeout: 10000 });

		// Get the markdown from the reloaded editor
		const result = await page.evaluate(() => {
			const ed = document.querySelector('.ProseMirror') as HTMLElement & {
				editor?: {
					commands: { setContent: (c: string, o?: object) => void };
					getMarkdown: () => string;
					getHTML: () => string;
				};
			};
			const editor = ed?.editor;
			if (!editor) return { error: 'editor not found' };
			return { markdown: editor.getMarkdown(), html: editor.getHTML() };
		});

		expect(result).not.toHaveProperty('error');
		// Blank lines should be preserved after save + reload
		expect(result.markdown).toContain(
			'First paragraph\n\n\n\nSecond paragraph',
		);
		// Soft breaks should be preserved
		expect(result.markdown).toMatch(/Line A {2}\nLine B/);
		// HTML should have the empty paragraph
		expect(result.html).toContain(
			'<p>First paragraph</p><p></p><p>Second paragraph</p>',
		);
	});
});
