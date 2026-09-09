import { expect, test } from '../fixtures';
import { createDraftAndOpenEditor } from '../helpers/wiki';

/**
 * Covers the callout as a *container* node: its body is content in the main
 * document (`content: 'block+'` + NodeViewContent), not a markdown string in an
 * attribute edited by a nested editor. So the assertions here are that the main
 * editor's own formatting reaches inside a callout, and that block children —
 * lists, code blocks, headings — survive the markdown round-trip.
 */

declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
				focus: () => void;
			};
			getMarkdown: () => string;
			getJSON: () => {
				type: string;
				content?: {
					type: string;
					attrs?: Record<string, unknown>;
					content?: { type: string }[];
				}[];
			};
		};
	}
}

const BOLD = process.platform === 'darwin' ? 'Meta+b' : 'Control+b';
const MOD_ENTER =
	process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

test.describe('Callout rich text', () => {
	test('a callout body parses into block children and round-trips', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(page, await wiki.space(), 'Callout rt');

		const result = await page.evaluate(() => {
			const source = [
				':::note[Test]',
				'This has **bold** and *italic* and [a link](https://example.com)',
				'',
				'- one',
				'- two',
				':::',
			].join('\n');

			window.wikiEditor.commands.setContent(source, {
				contentType: 'markdown',
			});
			const md1 = window.wikiEditor.getMarkdown();

			window.wikiEditor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = window.wikiEditor.getMarkdown();

			const callout = window.wikiEditor
				.getJSON()
				.content?.find((n) => n.type === 'calloutBlock');

			return {
				md1,
				roundTrip: md1 === md2,
				title: callout?.attrs?.title,
				childTypes: callout?.content?.map((child) => child.type),
			};
		});

		// The body is child nodes, not a string attribute.
		expect(result.childTypes).toEqual(['paragraph', 'bulletList']);
		expect(result.title).toBe('Test');

		// Every mark and the list survive serialization back to the fence.
		expect(result.md1).toContain('**bold**');
		expect(result.md1).toContain('*italic*');
		expect(result.md1).toContain('[a link](https://example.com)');
		expect(result.md1).toContain('- one');
		expect(result.md1).toMatch(/:::note\[Test\][\s\S]*:::/);

		expect(result.roundTrip).toBe(true);
	});

	test('the main editor formats text typed inside a callout', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(page, await wiki.space(), 'Callout typing');

		await page.evaluate(() => {
			window.wikiEditor.commands.setContent(':::tip\nlead\n:::', {
				contentType: 'markdown',
			});
		});

		// Type into the callout body the way an author would — no double-click,
		// no sub-editor: it is ordinary editable content.
		const body = page.locator('.callout-content p').first();
		await expect(body).toBeVisible({ timeout: 5000 });
		await body.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' ');

		// Toggle the editor's own bold shortcut, then type: the mark has to apply
		// to input inside the callout, which is only true if the body belongs to
		// the main editor.
		await page.keyboard.press(BOLD);
		await page.keyboard.type('emphasis');

		await expect(page.locator('.callout-content strong')).toHaveText(
			'emphasis',
		);

		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(markdown).toContain(':::tip');
		expect(markdown).toContain('**emphasis**');
	});

	test('the slash menu inserts a callout you can type straight into', async ({
		page,
		wiki,
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			'Callout slash',
		);

		await editor.click();
		await page.keyboard.type('/tip');
		await expect(
			page.locator('.slash-commands-list').getByText('Tip', { exact: true }),
		).toBeVisible({ timeout: 5000 });
		await page.keyboard.press('Enter');

		// setCallout seeds an empty paragraph, so the body is immediately
		// writable — no placeholder to double-click first.
		await expect(page.locator('.callout-content')).toBeVisible({
			timeout: 5000,
		});
		await page.locator('.callout-content p').first().click();
		await page.keyboard.type('written in place');

		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(markdown).toContain(':::tip\nwritten in place\n:::');
	});

	test('the title is editable in place', async ({ page, wiki }) => {
		await createDraftAndOpenEditor(page, await wiki.space(), 'Callout title');

		await page.evaluate(() => {
			window.wikiEditor.commands.setContent(':::note\nbody\n:::', {
				contentType: 'markdown',
			});
		});

		const title = page.locator('input.callout-title');
		await expect(title).toBeVisible({ timeout: 5000 });
		// A real value, not a placeholder: the author can select and delete it.
		await expect(title).toHaveValue('Note');

		await title.click();
		await page.keyboard.press(SELECT_ALL);
		await page.keyboard.type('Heads up');

		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(markdown).toContain(':::note[Heads up]');
	});

	test('an emptied title falls back to the type default', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			'Callout emptytitle',
		);

		await page.evaluate(() => {
			window.wikiEditor.commands.setContent(':::danger[Boom]\nbody\n:::', {
				contentType: 'markdown',
			});
		});

		const title = page.locator('input.callout-title');
		await expect(title).toHaveValue('Boom');

		await title.click();
		await page.keyboard.press(SELECT_ALL);
		await page.keyboard.press('Backspace');
		await page.locator('.callout-content p').first().click();

		// The published page always prints a title, so an emptied one means the
		// default rather than no header at all.
		await expect(title).toHaveValue('Danger');
		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		// Back to the default means back to a bare fence.
		expect(markdown).toContain(':::danger\n');
		expect(markdown).not.toContain('[Danger]');
	});

	test('the cursor can leave a callout that ends the document', async ({
		page,
		wiki,
	}) => {
		await createDraftAndOpenEditor(page, await wiki.space(), 'Callout exit');

		await page.evaluate(() => {
			window.wikiEditor.commands.setContent(':::note\nbody\n:::', {
				contentType: 'markdown',
			});
		});

		await page.locator('.callout-content p').first().click();
		await page.keyboard.press('End');
		await page.keyboard.press(MOD_ENTER);
		await page.keyboard.type('outside');

		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		// The typed text landed after the closing fence, not inside it.
		expect(markdown).toMatch(/:::\n\noutside/);
	});

	test('backspace removes an empty callout', async ({ page, wiki }) => {
		const editor = await createDraftAndOpenEditor(
			page,
			await wiki.space(),
			'Callout backspace',
		);

		await editor.click();
		await page.keyboard.type('/note');
		await expect(
			page.locator('.slash-commands-list').getByText('Note', { exact: true }),
		).toBeVisible({ timeout: 5000 });
		await page.keyboard.press('Enter');
		await expect(page.locator('.callout-content')).toBeVisible({
			timeout: 5000,
		});

		await page.locator('.callout-content p').first().click();
		await page.keyboard.press('Backspace');

		await expect(page.locator('.callout-content')).toHaveCount(0);
		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(markdown).not.toContain(':::');
	});

	test('block nodes are reachable inside a callout', async ({ page, wiki }) => {
		await createDraftAndOpenEditor(page, await wiki.space(), 'Callout blocks');

		const childTypes = await page.evaluate(() => {
			const source = [
				':::caution',
				'## Heading',
				'',
				'```js',
				'const a = 1;',
				'```',
				':::',
			].join('\n');

			window.wikiEditor.commands.setContent(source, {
				contentType: 'markdown',
			});

			const callout = window.wikiEditor
				.getJSON()
				.content?.find((n) => n.type === 'calloutBlock');
			return callout?.content?.map((child) => child.type);
		});

		// A heading and a fenced block inside a callout were unreachable while
		// the body was a string; degrading either to a bare paragraph is the
		// regression this guards.
		expect(childTypes).toEqual(['heading', 'codeBlock']);
	});

	test('the published page renders the callout body as real markup', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{
					title: 'Callout Page',
					content: [
						':::tip[Careful]',
						'Body with **bold** text.',
						'',
						'- first item',
						'- second item',
						':::',
						'',
					].join('\n'),
				},
			],
		});
		const doc = space.page('Callout Page');

		await page.goto(`/${doc.route}`);
		await page.waitForLoadState('networkidle');

		const callout = page.locator('#wiki-content aside.callout.callout-tip');
		await expect(callout).toBeVisible({ timeout: 10000 });

		// Alert's banner structure: header row, then a full-width body. The old
		// markup nested the body beside the title in a .callout-body cell.
		await expect(callout.locator('.callout-header .callout-title')).toHaveText(
			'Careful',
		);
		await expect(callout.locator('.callout-body')).toHaveCount(0);
		await expect(callout.locator('.callout-header svg')).toBeVisible();

		// The body is rendered markdown, not escaped text.
		await expect(callout.locator('.callout-content strong')).toHaveText('bold');
		await expect(callout.locator('.callout-content li')).toHaveCount(2);

		// Neutral surface — the type shows only in the icon's colour.
		const surface = await callout.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);
		const iconColor = await callout
			.locator('.callout-icon')
			.evaluate((el) => getComputedStyle(el).color);
		expect(surface).not.toBe(iconColor);
	});
});
