import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

/**
 * Regression coverage for frappe/wiki#609:
 * "When copy pasting markdown text, wiki editor does not render it automatically."
 *
 * The editor's `handlePaste` (WikiEditor.vue) treats plain-text-only clipboard
 * payloads as markdown, so pasting `# Heading` or `**bold**` renders instead of
 * staying literal. When the clipboard also carries HTML (Word, Google Docs, web
 * pages) the default ProseMirror handler keeps the rich formatting untouched.
 */
test.describe('Markdown Paste (#609)', () => {
	/**
	 * Fire a real `paste` ClipboardEvent at the ProseMirror DOM node so the
	 * editor's own `handlePaste` runs — exactly the path a user's Cmd+V takes.
	 * `html` is optional; omitting it reproduces the plain-text-only clipboard
	 * that issue #609 is about.
	 */
	async function pasteIntoEditor(
		page: import('@playwright/test').Page,
		text: string,
		html?: string,
	) {
		return page.evaluate(
			({ text, html }) => {
				const dom = document.querySelector('.ProseMirror') as
					| (HTMLElement & { editor?: { getHTML: () => string } })
					| null;
				if (!dom) return { error: 'editor not found' };
				dom.focus();

				const dt = new DataTransfer();
				dt.setData('text/plain', text);
				if (html) dt.setData('text/html', html);

				dom.dispatchEvent(
					new ClipboardEvent('paste', {
						clipboardData: dt,
						bubbles: true,
						cancelable: true,
					}),
				);

				return { html: dom.editor?.getHTML() ?? dom.innerHTML };
			},
			{ text, html },
		);
	}

	test('pasting plain-text markdown renders it (headings, bold, list)', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`md-paste-${Date.now()}`,
		);
		await editor.click();

		const result = await pasteIntoEditor(
			page,
			'# Heading One\n\n**bold** and *italic*\n\n- item 1\n- item 2',
		);

		expect(result).not.toHaveProperty('error');
		// Before the #609 fix this stayed literal (a plain paragraph of the raw
		// markdown source); now each construct renders to real nodes.
		expect(result.html).toContain('<h1>Heading One</h1>');
		expect(result.html).toContain('<strong>bold</strong>');
		expect(result.html).toContain('<em>italic</em>');
		expect(result.html).toMatch(/<ul>.*<li>.*item 1.*<\/li>.*<li>.*item 2/s);
		// The raw markdown markers must NOT survive as literal text.
		expect(result.html).not.toContain('# Heading One');
		expect(result.html).not.toContain('**bold**');
	});

	test('pasting rich HTML keeps its formatting (does not re-parse as markdown)', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`md-paste-html-${Date.now()}`,
		);
		await editor.click();

		// A Google-Docs-style clipboard: both text/plain and text/html present.
		// The plain-text side carries markdown-looking asterisks that must NOT be
		// interpreted — the HTML side wins and its <strong> is preserved verbatim.
		const result = await pasteIntoEditor(
			page,
			'**not markdown**',
			'<p><strong>rich bold</strong></p>',
		);

		expect(result).not.toHaveProperty('error');
		expect(result.html).toContain('<strong>rich bold</strong>');
		expect(result.html).not.toContain('not markdown');
	});
});
