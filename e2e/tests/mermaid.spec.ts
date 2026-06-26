import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

/**
 * Covers the Mermaid diagram feature: the editor node (parse + live preview +
 * markdown round-trip) and the public server-rendered reader (fence hydrated to
 * SVG). The storage format is a standard ```mermaid fenced code block.
 */
const MERMAID_MARKDOWN =
	'```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n';

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
				content?: { type: string; attrs?: Record<string, unknown> }[];
			};
		};
	}
}

/**
 * Create a draft page and open the editor. Mirrors the helper in
 * iframe-embed.spec.ts — duplicated here rather than exported so changes to one
 * test don't ripple into others.
 */
async function createDraftAndOpenEditor(
	page: import('@playwright/test').Page,
	title: string,
) {
	await page.goto('/wiki');
	await page.waitForLoadState('networkidle');

	const spaceLink = page.locator('a[href*="/wiki/spaces/"]').first();
	await expect(spaceLink).toBeVisible({ timeout: 5000 });
	await spaceLink.click();
	await page.waitForLoadState('networkidle');

	const createFirstPage = page.locator('button:has-text("Create First Page")');
	const newPageButton = page.locator('button[title="New Page"]');

	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await newPageButton.click();
	}

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

test.describe('Mermaid diagrams', () => {
	test('parses a ```mermaid fence into a node and previews it as SVG', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `mermaid-edit-${Date.now()}`);

		const code = await page.evaluate((md) => {
			window.wikiEditor.commands.setContent(md, { contentType: 'markdown' });
			const json = window.wikiEditor.getJSON();
			const block = json.content?.find((n) => n.type === 'mermaidBlock');
			return block?.attrs?.code as string | undefined;
		}, MERMAID_MARKDOWN);

		// The fence body became the node's source, not a plain code block.
		expect(code).toContain('flowchart TD');

		// The node view renders a live SVG preview of the diagram.
		await expect(page.locator('.mermaid-block-svg svg').first()).toBeVisible({
			timeout: 10000,
		});
	});

	test('round-trips the mermaid fence without drift', async ({ page }) => {
		await createDraftAndOpenEditor(page, `mermaid-roundtrip-${Date.now()}`);

		const { md1, md2 } = await page.evaluate((md) => {
			window.wikiEditor.commands.setContent(md, { contentType: 'markdown' });
			const md1 = window.wikiEditor.getMarkdown();
			// Re-parse the serialized markdown and re-serialize — the cycle that
			// would expose escaping/blank-line drift.
			window.wikiEditor.commands.setContent(md1, { contentType: 'markdown' });
			const md2 = window.wikiEditor.getMarkdown();
			return { md1, md2 };
		}, MERMAID_MARKDOWN);

		expect(md1).toContain('```mermaid');
		expect(md1).toContain('flowchart TD');
		// Serialization is idempotent — a second round-trip must not drift.
		expect(md2).toBe(md1);
	});

	test('renders multiple diagrams independently without colliding', async ({
		page,
	}) => {
		await createDraftAndOpenEditor(page, `mermaid-multi-${Date.now()}`);

		const twoDiagrams =
			'```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n\n' +
			'```mermaid\ngraph LR\n  X --> Y --> Z\n```\n';
		await page.evaluate((md) => {
			window.wikiEditor.commands.setContent(md, { contentType: 'markdown' });
		}, twoDiagrams);

		// Both blocks must render their own SVG — a shared render id used to make
		// one diagram render glitchy while the other stayed blank.
		const svgs = page.locator('.mermaid-block-svg svg');
		await expect(svgs).toHaveCount(2, { timeout: 10000 });

		const ids = await svgs.evaluateAll((nodes) =>
			nodes.map((n) => (n as SVGElement).id),
		);
		expect(new Set(ids).size).toBe(2); // distinct render ids
	});

	test('renders the diagram as inline SVG on the public page', async ({
		page,
		request,
	}) => {
		const spaceRoute = `mermaid-space-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceRoute,
			is_published: true,
		});
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceRoute}/root`,
			is_group: true,
			is_published: true,
		});
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});
		const doc = await createTestWikiDocument(request, {
			title: 'Mermaid Page',
			route: `${spaceRoute}/diagram`,
			content: MERMAID_MARKDOWN,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		try {
			await page.goto(`/${doc.route}`);
			await page.waitForLoadState('networkidle');

			// Server emits the fence as <pre class="mermaid">, not a code block.
			const container = page.locator('#wiki-content .mermaid').first();
			await expect(container).toBeAttached({ timeout: 10000 });

			// mermaid-renderer.js lazy-loads Mermaid and hydrates it into an SVG.
			await expect(
				page.locator('#wiki-content .mermaid svg').first(),
			).toBeVisible({ timeout: 15000 });
		} finally {
			await deleteTestWikiDocument(request, doc.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});
});
