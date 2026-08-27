import { expect, test } from '@playwright/test';
import { APP_BASE, spaceLinkSelector } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

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

/**
 * Create a draft page and open the editor. Mirrors the helper in
 * mermaid.spec.ts — duplicated rather than exported so changes to one test
 * don't ripple into others.
 */
async function createDraftAndOpenEditor(
	page: import('@playwright/test').Page,
	title: string,
) {
	await page.goto(APP_BASE);
	await page.waitForLoadState('networkidle');

	const spaceLink = page.locator(spaceLinkSelector()).first();
	await expect(spaceLink).toBeVisible({ timeout: 5000 });
	await spaceLink.click();
	await page.waitForLoadState('networkidle');

	await openNewPageDialog(page);

	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	await page.locator('aside').getByText(title, { exact: true }).click();

	const editor = page.locator('.ProseMirror, [contenteditable="true"]');
	await expect(editor).toBeVisible({ timeout: 10000 });

	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	return editor;
}

test.describe('Callout rich text', () => {
	test('a callout body parses into block children and round-trips', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `callout-rt-${Date.now()}`);

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
	}) => {
		await createDraftAndOpenEditor(page, `callout-typing-${Date.now()}`);

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
	}) => {
		const editor = await createDraftAndOpenEditor(
			page,
			`callout-slash-${Date.now()}`,
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

	test('block nodes are reachable inside a callout', async ({ page }) => {
		await createDraftAndOpenEditor(page, `callout-blocks-${Date.now()}`);

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
});
