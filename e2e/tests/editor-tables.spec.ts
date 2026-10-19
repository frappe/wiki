import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { saveEditor } from '../helpers/wiki';

const TABLE_A = '| a | b |\n| --- | --- |\n| 1 | 2 |';
const TABLE_B = '| c | d |\n| --- | --- |\n| 3 | 4 |';
const TABLE_C = '| e | f |\n| --- | --- |\n| 5 | 6 |';
const RICH_TABLE = [
	'| Left | Center | Right |',
	'| :--- | :---: | ---: |',
	'| **bold** | [link](https://example.com) | `code` |',
	'| a \\| b |  | *em* |',
	'| <u>under</u> | ~~strike~~ | ***both*** |',
	'| line one<br>line two | `a|b` | [**bold link**](/x) |',
].join('\n');

// Every block the editor offers, placed above, below, between and next to
// tables. Each entry is [label, markdown, node type it must parse to].
const NEIGHBOURS: [string, string, string][] = [
	['paragraph', 'Plain paragraph', 'paragraph'],
	[
		'styled paragraph',
		'*italic* <u>underline</u> **bold** ~~strike~~ `code` [link](https://example.com)',
		'paragraph',
	],
	['heading', '## Heading two', 'heading'],
	['image', '![telemetry](/files/telemetry_card.png)', 'image'],
	['video', '![demo](/files/demo.mp4)', 'videoBlock'],
	['pdf', '![Test File.pdf](/files/Test%20File.pdf)', 'pdfBlock'],
	[
		'iframe',
		'<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>',
		'iframeBlock',
	],
	['mermaid', '```mermaid\nflowchart TD\n  A --> B\n```', 'mermaidBlock'],
	['code block', '```js\nconst x = 1;\n```', 'codeBlock'],
	['callout', ':::note[Note]\nhello\n:::', 'calloutBlock'],
	['bullet list', '- one\n- two', 'bulletList'],
	['ordered list', '1. one\n2. two', 'orderedList'],
	['task list', '- [ ] todo\n- [x] done', 'taskList'],
	['blockquote', '> quoted', 'blockquote'],
	['horizontal rule', '---', 'horizontalRule'],
];

type Case = {
	title: string;
	content: string;
	tables: number;
	types?: string[];
};

// Each case is a page body that must open, stay put, and survive a save.
const CASES: Case[] = [
	{ title: 'Adjacent tables', content: `${TABLE_A}\n\n${TABLE_B}`, tables: 2 },
	{
		title: 'Three adjacent tables',
		content: `${TABLE_A}\n\n${TABLE_B}\n\n${TABLE_C}`,
		tables: 3,
	},
	{ title: 'Table only', content: TABLE_A, tables: 1 },
	{
		title: 'Blank lines between tables',
		content: `${TABLE_A}\n\n\n\n${TABLE_B}`,
		tables: 2,
	},
	{
		title: 'Rich adjacent tables',
		content: `${RICH_TABLE}\n\n${RICH_TABLE}`,
		tables: 2,
	},
	{
		title: 'Table inside callout',
		content: `:::note[Note]\n${TABLE_A}\n:::\n\n${TABLE_B}`,
		tables: 2,
		types: ['calloutBlock', 'table'],
	},
	// Neighbour above, below, between, and two tables touching.
	...NEIGHBOURS.map(([label, block, type]) => ({
		title: `Tables with ${label}`,
		content: `${block}\n\n${TABLE_A}\n\n${block}\n\n${TABLE_B}\n\n${TABLE_C}\n\n${block}`,
		tables: 3,
		types: [type, 'table'],
	})),
];

function blockShape(page: Page) {
	return page.evaluate(() =>
		(window as EditorWindow).wikiEditor?.state.doc
			.toJSON()
			.content.map((node) => node.type)
			.join(','),
	);
}

// The editor publishes its TipTap instance on window for E2E specs.
type WikiEditor = {
	getMarkdown: () => string;
	markdown: {
		parse: (markdown: string) => unknown;
		serialize: (doc: unknown) => string;
	};
	state: {
		doc: {
			firstChild: { nodeSize: number };
			toJSON: () => { content: { type: string }[] };
		};
	};
	// biome-ignore lint/suspicious/noExplicitAny: TipTap's chain is untyped here
	chain: () => any;
};
type EditorWindow = Window & { wikiEditor?: WikiEditor };

function roundTrip(page: Page) {
	return page.evaluate(() => {
		const editor = (window as EditorWindow).wikiEditor;
		const first = editor?.getMarkdown() ?? '';
		const manager = editor?.markdown;
		const second = manager ? manager.serialize(manager.parse(first)) : '';
		return { first, second };
	});
}

async function openEditor(page: Page, url: string) {
	await page.goto(url);
	await expect(page.locator('.ProseMirror').first()).toBeVisible({
		timeout: 15000,
	});
	await page.waitForFunction(
		() => (window as EditorWindow).wikiEditor !== undefined,
	);
}

test.describe('Editor tables (#872)', () => {
	test('table layouts open, stay stable and survive a save', async ({
		page,
		wiki,
	}) => {
		test.setTimeout(CASES.length * 30000);
		const space = await wiki.space({
			pages: CASES.map(({ title, content }) => ({ title, content })),
		});

		for (const { title, tables, types = [] } of CASES) {
			await test.step(title, async () => {
				const url = space.url('page', space.page(title).name);
				await openEditor(page, url);
				await expect(page.locator('.ProseMirror table')).toHaveCount(tables);

				// The loop grew the doc a paragraph at a time, so a settled editor
				// must hold the same shape a moment later.
				const shape = await blockShape(page);
				for (const type of types) expect(shape).toContain(type);
				await page.waitForTimeout(1500);
				expect(await blockShape(page)).toBe(shape);
				await expect(page.getByText('Unsaved changes')).toHaveCount(0);

				const { first, second } = await roundTrip(page);
				expect(second).toBe(first);

				await page.evaluate(() =>
					(window as EditorWindow).wikiEditor
						?.chain()
						.focus('end')
						.insertContent('edited')
						.run(),
				);
				const editedShape = await blockShape(page);
				await saveEditor(page);
				await expect(page.getByText('Unsaved changes')).toHaveCount(0, {
					timeout: 10000,
				});

				await openEditor(page, url);
				await expect(page.locator('.ProseMirror table')).toHaveCount(tables);
				await expect(page.locator('.ProseMirror')).toContainText('edited');
				expect(await blockShape(page)).toBe(editedShape);
			});
		}
	});

	test('inserting a table right after a table keeps both', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Insert After Table', content: TABLE_A }],
		});
		const url = space.url('page', space.page('Insert After Table').name);
		await openEditor(page, url);

		await page.evaluate(() => {
			const editor = (window as EditorWindow).wikiEditor;
			if (!editor) return;
			const end = editor.state.doc.firstChild.nodeSize;
			const cell = (text: string, type: string) => ({
				type,
				content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
			});
			editor
				.chain()
				.insertContentAt(end, {
					type: 'table',
					content: [
						{ type: 'tableRow', content: [cell('x', 'tableHeader')] },
						{ type: 'tableRow', content: [cell('y', 'tableCell')] },
					],
				})
				.run();
		});
		await expect(page.locator('.ProseMirror table')).toHaveCount(2);
		const shape = await blockShape(page);
		await saveEditor(page);
		await expect(page.getByText('Unsaved changes')).toHaveCount(0, {
			timeout: 10000,
		});

		await openEditor(page, url);
		await expect(page.locator('.ProseMirror table')).toHaveCount(2);
		await page.waitForTimeout(1500);
		expect(await blockShape(page)).toBe(shape);
	});
});
