import {
	type APIRequestContext,
	type Page,
	expect,
	test,
} from '@playwright/test';
import { appUrl } from '../helpers/routes';
import {
	cleanupWikiSpacesByRoute,
	createTestWikiSpace,
	openNewPageDialog,
} from '../helpers/wiki';

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

const createdRoutes: string[] = [];

/**
 * Create a throwaway space via the API, then a draft page in it through the
 * sidebar, and open the editor.
 *
 * The space is per-test on purpose: the "click the first space" idiom every
 * other editor spec opens with lands in whichever space the site happens to
 * list first, whose page tree grows with every run — slow to render locally,
 * and the pages are never cleaned up. A fresh space keeps the tree at one item
 * and `afterEach` takes the whole thing away again.
 */
async function createDraftAndOpenEditor(
	page: Page,
	request: APIRequestContext,
	label: string,
) {
	const spaceRoute = `callout-${label}-${Date.now()}`;
	const space = await createTestWikiSpace(request, {
		route: spaceRoute,
		is_published: true,
	});
	createdRoutes.push(spaceRoute);

	await page.goto(appUrl('spaces', space.name));
	await page.waitForLoadState('networkidle');

	await openNewPageDialog(page);
	const title = `Callout ${label}`;
	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	// Creating a page can land on the draft route before the change-request
	// overlay is readable, which locally is queue lag rather than a product bug
	// — one reload settles it (same retry as editor-toc.spec.ts).
	const editor = page.locator('.ProseMirror');
	for (let attempt = 0; attempt < 3; attempt++) {
		if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) break;
		await page.reload();
		await page.waitForLoadState('networkidle');
		await page
			.locator('aside')
			.getByText(title, { exact: false })
			.first()
			.click();
	}
	await expect(editor).toBeVisible({ timeout: 10000 });

	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	return editor;
}

test.describe('Callout rich text', () => {
	test.afterEach(async ({ request }) => {
		while (createdRoutes.length) {
			const route = createdRoutes.pop() as string;
			await cleanupWikiSpacesByRoute(request, route).catch(() => {});
		}
	});

	test('a callout body parses into block children and round-trips', async ({
		page,
		request,
	}) => {
		await createDraftAndOpenEditor(page, request, 'rt');

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
		request,
	}) => {
		await createDraftAndOpenEditor(page, request, 'typing');

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
		request,
	}) => {
		const editor = await createDraftAndOpenEditor(page, request, 'slash');

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

	test('the title is editable in place', async ({ page, request }) => {
		await createDraftAndOpenEditor(page, request, 'title');

		await page.evaluate(() => {
			window.wikiEditor.commands.setContent(':::note\nbody\n:::', {
				contentType: 'markdown',
			});
		});

		const title = page.locator('input.callout-title');
		await expect(title).toBeVisible({ timeout: 5000 });
		// Empty title falls back to the type's default as a placeholder.
		await expect(title).toHaveAttribute('placeholder', 'Note');

		await title.click();
		await page.keyboard.type('Heads up');

		const markdown = await page.evaluate(() => window.wikiEditor.getMarkdown());
		expect(markdown).toContain(':::note[Heads up]');
	});

	test('the cursor can leave a callout that ends the document', async ({
		page,
		request,
	}) => {
		await createDraftAndOpenEditor(page, request, 'exit');

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

	test('backspace removes an empty callout', async ({ page, request }) => {
		const editor = await createDraftAndOpenEditor(page, request, 'backspace');

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

	test('block nodes are reachable inside a callout', async ({
		page,
		request,
	}) => {
		await createDraftAndOpenEditor(page, request, 'blocks');

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
