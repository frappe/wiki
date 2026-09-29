import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor, saveEditor } from '../helpers/wiki';

type EditorWindow = Window & {
	wikiEditor: { getMarkdown: () => string };
};

function editorMarkdown(page: import('@playwright/test').Page) {
	return page.evaluate(() =>
		(window as unknown as EditorWindow).wikiEditor.getMarkdown(),
	);
}

test.describe('Underline', () => {
	test('toolbar underline saves as <u> and survives a reload', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`underline-${Date.now()}`,
		);
		await editor.click();
		await page.keyboard.type('plain ');
		await page.getByRole('button', { name: 'Underline' }).first().click();
		await page.keyboard.type('marked');

		await expect(editor.locator('u')).toHaveText('marked');
		expect(await editorMarkdown(page)).toBe('plain <u>marked</u>');

		await saveEditor(page);
		await page.waitForLoadState('networkidle');
		await page.reload();
		await expect(page.locator('.ProseMirror u').first()).toHaveText('marked');
	});

	test('pasting a copied hyperlink does not underline it (#667)', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`underline-paste-${Date.now()}`,
		);
		await editor.click();

		await page.evaluate(() => {
			const dom = document.querySelector('.ProseMirror') as HTMLElement;
			const clipboard = new DataTransfer();
			clipboard.setData('text/plain', 'Frappe');
			clipboard.setData(
				'text/html',
				'<a href="https://frappe.io" style="text-decoration: underline;">Frappe</a> and <span style="text-decoration: underline;">docs</span>',
			);
			dom.dispatchEvent(
				new ClipboardEvent('paste', {
					clipboardData: clipboard,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(await editorMarkdown(page)).toBe(
			'[Frappe](https://frappe.io) and <u>docs</u>',
		);
	});
});
