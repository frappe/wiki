import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

/**
 * Covers the editor's inline ":" emoji suggestion (frappe-ui's Emoji extension).
 */

test.describe('Emoji', () => {
	test('inline ":" suggestion inserts an emoji', async ({ page, wiki }) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			`emoji-inline-${Date.now()}`,
		);

		await editor.click();
		await page.keyboard.type(':grinning');

		const suggestions = page.getByRole('dialog', { name: 'Suggestions' });
		await expect(
			suggestions.getByText('grinning', { exact: true }),
		).toBeVisible({
			timeout: 5000,
		});

		await page.keyboard.press('Enter');
		await expect(editor).toContainText('😀');
		await expect(editor).not.toContainText(':grinning');
	});
});
