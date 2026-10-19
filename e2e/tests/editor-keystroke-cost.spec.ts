import { expect, test } from '../fixtures';

const CONTENT = [
	'## First heading',
	'Some **bold** text.',
	...Array.from({ length: 60 }, (_, i) => `Filler paragraph ${i}.`),
	'- one\n- two',
	'| a | b |\n| --- | --- |\n| 1 | 2 |',
	'## Last heading',
].join('\n\n');

const TYPED = 'typing should not serialize';

type EditorWindow = Window & {
	wikiEditor?: { getMarkdown: () => string };
	serializeCalls?: number;
};

test.describe('Editor keystroke cost', () => {
	test('opens at the top, survives undo and does not serialize per keystroke', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Keystroke Cost', content: CONTENT }],
		});
		await page.goto(space.url('page', space.page('Keystroke Cost').name));
		const editor = page.locator('.ProseMirror').first();
		await expect(editor).toContainText('Last heading', { timeout: 15000 });
		await expect(editor.locator('table')).toHaveCount(1);
		await expect(
			editor.getByRole('heading', { name: 'First heading' }),
		).toBeInViewport();

		await editor.click();
		await page.keyboard.press('ControlOrMeta+z');
		await expect(editor).toContainText('First heading');
		await expect(editor).toContainText('Last heading');
		await expect(page.getByText('Unsaved changes')).toHaveCount(0);

		await page.evaluate(() => {
			const win = window as EditorWindow;
			const instance = win.wikiEditor;
			if (!instance) throw new Error('wikiEditor is not exposed');
			const getMarkdown = instance.getMarkdown;
			win.serializeCalls = 0;
			instance.getMarkdown = function () {
				win.serializeCalls = (win.serializeCalls ?? 0) + 1;
				return getMarkdown.call(this);
			};
		});
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(TYPED);

		const calls = await page.evaluate(
			() => (window as EditorWindow).serializeCalls,
		);
		expect(calls).toBeLessThan(TYPED.length);
		await expect(editor).toContainText(TYPED);
		await expect(page.getByText('Unsaved changes').first()).toBeVisible();
	});
});
