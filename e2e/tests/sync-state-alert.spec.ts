import { expect, test } from '../fixtures';
import { delayMethod, saveEditor } from '../helpers';

const BATCH_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.apply_cr_operations';

test.describe('Sync state alert', () => {
	test('a save in flight reads as progress, not as a warning', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Alpha', content: 'Alpha.' }],
		});
		await wiki.changeRequest(space);
		await page.goto(space.url('page', space.page('Alpha').name));
		const editor = page.locator('.ProseMirror').first();
		await expect(editor).toBeVisible({ timeout: 15000 });

		const unroute = await delayMethod(page, BATCH_METHOD, 11000);
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' More.');
		await saveEditor(page);

		const alert = page.getByTestId('sync-state-alert');
		await expect(alert).toHaveText('Saving…');
		await expect(alert).toHaveAttribute('role', 'status');
		await expect(alert).toHaveAttribute('data-color', 'gray');

		await unroute();
		await expect(alert).toBeHidden({ timeout: 20000 });
	});
});
