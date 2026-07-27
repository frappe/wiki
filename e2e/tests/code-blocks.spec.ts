import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

/**
 * highlight.js is ~160 KB and most doc pages carry no code at all, so the reader
 * only fetches it once a page actually has a code block — including after SPA
 * navigation, which swaps #wiki-content without a document load.
 */
const CODE_MARKDOWN = '```python\nprint("hello")\n```\n';

test.describe('Code blocks', () => {
	test('fetches the highlighter only for pages that contain code', async ({
		page,
		request,
	}) => {
		const spaceRoute = `code-blocks-${Date.now()}`;
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
		const proseDoc = await createTestWikiDocument(request, {
			title: 'Prose Page',
			route: `${spaceRoute}/prose`,
			content: 'Just words, no code here.\n',
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		const codeDoc = await createTestWikiDocument(request, {
			title: 'Code Page',
			route: `${spaceRoute}/code`,
			content: CODE_MARKDOWN,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		const highlightRequests: string[] = [];
		page.on('request', (req) => {
			if (req.url().includes('wiki-highlight.bundle.js')) {
				highlightRequests.push(req.url());
			}
		});

		try {
			await page.goto(`/${proseDoc.route}`);
			await page.waitForLoadState('networkidle');
			expect(await page.locator('#wiki-content pre > code').count()).toBe(0);
			expect(highlightRequests).toHaveLength(0);

			await page.goto(`/${codeDoc.route}`);
			await page.waitForLoadState('networkidle');
			expect(highlightRequests).toHaveLength(1);

			// Loaded is not enough — the gutter and toolbar only attach to blocks
			// highlight.js has already marked with .hljs.
			await expect(
				page.locator('#wiki-content pre code.hljs').first(),
			).toBeVisible();
			await expect(
				page.locator('#wiki-content pre.code-block-enhanced').first(),
			).toBeVisible();
		} finally {
			await deleteTestWikiDocument(request, codeDoc.name).catch(() => {});
			await deleteTestWikiDocument(request, proseDoc.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});

	test('loads the highlighter on SPA navigation into a code page', async ({
		page,
		request,
	}) => {
		const spaceRoute = `code-blocks-spa-${Date.now()}`;
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
		const proseDoc = await createTestWikiDocument(request, {
			title: 'Prose First',
			route: `${spaceRoute}/prose-first`,
			content: 'Nothing but prose.\n',
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});
		const codeDoc = await createTestWikiDocument(request, {
			title: 'Code Second',
			route: `${spaceRoute}/code-second`,
			content: CODE_MARKDOWN,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		try {
			// The reader sidebar is desktop-only; below lg it collapses to a sheet.
			await page.setViewportSize({ width: 1100, height: 900 });
			await page.goto(`/${proseDoc.route}`);
			await page.waitForLoadState('networkidle');

			// Sidebar click swaps #wiki-content in place; no document request, so
			// the bundle has to arrive via initCodeBlocks().
			await page
				.locator(`.wiki-sidebar a[href="/${codeDoc.route}"]`)
				.first()
				.click();
			await expect(
				page.locator('#wiki-content pre > code').first(),
			).toBeAttached({
				timeout: 10000,
			});

			await expect(
				page.locator('#wiki-content pre code.hljs').first(),
			).toBeVisible({
				timeout: 10000,
			});
			await expect(
				page.locator('#wiki-content pre.code-block-enhanced').first(),
			).toBeVisible();
		} finally {
			await deleteTestWikiDocument(request, codeDoc.name).catch(() => {});
			await deleteTestWikiDocument(request, proseDoc.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});
});
