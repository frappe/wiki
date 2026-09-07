import { type APIRequestContext, type Page, expect } from '@playwright/test';
import { createDoc, deleteDoc, getDoc, getList } from './frappe';

/**
 * Tear down every Wiki Space with the given (test-unique) route.
 *
 * `Wiki Space` cascades its documents, revisions and root group on delete (see
 * its `on_trash`), so a single atomic `deleteDoc` removes the whole space —
 * important for a git-synced space, which is read-only and otherwise lingers as
 * the newest entry in the app's space list (ordered by creation desc), trapping
 * later specs whose helpers author into the first space (no "New Page" button).
 *
 * Resolving by route rather than the create response means a space the server
 * created but whose response the client never saw — a `createDoc` that timed
 * out, or a Playwright retry that created a second space — is still cleaned up.
 */
export async function cleanupWikiSpacesByRoute(
	request: APIRequestContext,
	route: string,
): Promise<void> {
	const found = await getList<{ name: string }>(request, 'Wiki Space', {
		fields: ['name'],
		filters: { route },
		limit: 0,
	}).catch(() => []);
	for (const space of found)
		await deleteDoc(request, 'Wiki Space', space.name).catch(() => {});
}

/**
 * Publish the change request currently open on the review page. The header
 * primary action is Approve-only; the combined "Approve & Merge" lives in the
 * three-dots menu and opens a confirm dialog. Waits for the merged toast.
 */
export async function publishChangeRequestFromReview(page: Page) {
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Approve & Merge' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Approve & Merge', exact: true })
		.click();
	await expect(page.locator('text=Change request merged').first()).toBeVisible({
		timeout: 15000,
	});
}

/**
 * The sidebar footer creates a page directly; the rarer kinds (group, external
 * link, tab) sit behind the chevron beside it. Opens the right one either way.
 */
export async function clickSidebarAddOption(
	page: Page,
	option: 'New Page' | 'New Group' | 'External Link',
) {
	if (option === 'New Page') {
		await newPageButton(page).click();
		return;
	}
	await page.locator('button[title="Add a group or link"]').click();
	await page.getByRole('menuitem', { name: option }).click();
}

/**
 * The sidebar's own "New page" button, which renders whether or not the space
 * already has pages. Scoped to the sidebar: an empty space draws a second
 * "New page" in the content column (spec 02 phase 5), so the name alone is
 * ambiguous there. The mobile tree lives in a drawer that is an aside too.
 */
export function newPageButton(page: Page) {
	return page
		.getByRole('complementary')
		.getByRole('button', { name: 'New page', exact: true })
		.first();
}

/**
 * Start creating a page from the sidebar. Leaves the create dialog open.
 */
export async function openNewPageDialog(page: Page) {
	await newPageButton(page).click();
}

/**
 * Create a page in `space` through the sidebar and open it in the editor.
 *
 * Every editor spec used to open with "click whatever space is listed first",
 * which grew that space's tree on every run and left the pages behind. Seeding
 * a space from the factory and authoring into it keeps the tree at one item and
 * lets one space delete take the draft away again.
 *
 * A created page lands on the draft route, which can render before the
 * change-request overlay is readable — locally that is queue lag rather than a
 * product bug, and one reload settles it.
 */
export async function createDraftAndOpenEditor(
	page: Page,
	space: { url(...segments: string[]): string },
	title: string,
	options: { waitForEditorApi?: boolean } = {},
) {
	await page.goto(space.url());
	await page.waitForLoadState('networkidle');

	await openNewPageDialog(page);
	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForLoadState('networkidle');

	const editor = page.locator('.ProseMirror').first();
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

	// The editor publishes its command API on the window once mounted; specs
	// that drive it through page.evaluate need that to have happened.
	if (options.waitForEditorApi !== false) {
		await page.waitForFunction(
			() => (window as { wikiEditor?: unknown }).wikiEditor !== undefined,
			{ timeout: 10000 },
		);
	}
	return editor;
}

/**
 * Wiki Space document interface.
 */
export interface WikiSpace {
	name: string;
	route: string;
	is_published?: boolean;
	creation?: string;
	modified?: string;
}

/**
 * Wiki Document interface.
 */
export interface WikiDocument {
	name: string;
	title: string;
	route: string;
	content?: string;
	wiki_space?: string;
	parent_wiki_document?: string;
	is_group?: boolean;
	is_published?: boolean;
	sort_order?: number;
	creation?: string;
	modified?: string;
}

/**
 * Generate a unique title for test wiki documents.
 */
export function generateWikiTitle(prefix = 'Test Page'): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `${prefix} ${timestamp}-${random}`;
}

/**
 * Create a test wiki space via API.
 * If root_group is not provided, creates a root group document automatically.
 */
export async function createTestWikiSpace(
	request: APIRequestContext,
	options: {
		route?: string;
		is_published?: boolean;
		root_group?: string;
	} = {},
): Promise<WikiSpace> {
	const route = options.route || `test-space-${Date.now()}`;

	return createDoc<WikiSpace>(request, 'Wiki Space', {
		route,
		is_published: options.is_published ?? true,
		root_group: options.root_group,
	});
}

/**
 * Delete a test wiki space via API.
 */
export async function deleteTestWikiSpace(
	request: APIRequestContext,
	name: string,
): Promise<void> {
	await deleteDoc(request, 'Wiki Space', name);
}

/**
 * Create a test wiki document via API.
 */
export async function createTestWikiDocument(
	request: APIRequestContext,
	options: {
		title?: string;
		route?: string;
		content?: string;
		wiki_space?: string;
		parent_wiki_document?: string;
		is_group?: boolean;
		is_published?: boolean;
	} = {},
): Promise<WikiDocument> {
	const title = options.title || generateWikiTitle();
	const route = options.route || title.toLowerCase().replace(/\s+/g, '-');

	return createDoc<WikiDocument>(request, 'Wiki Document', {
		title,
		route,
		content: options.content || `Content for ${title}`,
		wiki_space: options.wiki_space,
		parent_wiki_document: options.parent_wiki_document,
		is_group: options.is_group ?? false,
		is_published: options.is_published ?? true,
	});
}

/**
 * Delete a test wiki document via API.
 */
export async function deleteTestWikiDocument(
	request: APIRequestContext,
	name: string,
): Promise<void> {
	await deleteDoc(request, 'Wiki Document', name);
}

/**
 * Get a wiki document by name via API.
 */
export async function getWikiDocument(
	request: APIRequestContext,
	name: string,
): Promise<WikiDocument> {
	return getDoc<WikiDocument>(request, 'Wiki Document', name);
}

/**
 * Get a wiki space by name via API.
 */
export async function getWikiSpace(
	request: APIRequestContext,
	name: string,
): Promise<WikiSpace> {
	return getDoc<WikiSpace>(request, 'Wiki Space', name);
}

/**
 * List wiki documents via API.
 */
export async function listWikiDocuments(
	request: APIRequestContext,
	options: {
		filters?: Record<string, unknown>;
		limit?: number;
	} = {},
): Promise<WikiDocument[]> {
	return getList<WikiDocument>(request, 'Wiki Document', {
		fields: ['name', 'title', 'route', 'is_published', 'wiki_space'],
		filters: options.filters,
		limit: options.limit,
	});
}

/**
 * Cleanup test wiki documents matching a title pattern.
 */
export async function cleanupTestWikiDocuments(
	request: APIRequestContext,
	titlePattern = 'Test Page',
): Promise<void> {
	const docs = await listWikiDocuments(request, {
		filters: { title: ['like', `${titlePattern}%`] },
		limit: 100,
	});

	for (const doc of docs) {
		try {
			await deleteTestWikiDocument(request, doc.name);
		} catch (error) {
			console.warn(`Failed to delete ${doc.name}:`, error);
		}
	}
}

/**
 * The doc key of the draft currently open in the editor.
 *
 * A page created through the sidebar first lands on a temp key
 * (`/draft/tmp_…`) and is promoted to its real doc key once the create
 * round-trips. Reading the segment straight after the create therefore yields a
 * key no Wiki Document will ever carry — this waits for the promotion instead.
 */
export async function currentDraftDocKey(page: Page): Promise<string> {
	await page.waitForURL(/\/draft\/(?!tmp_)[^/?#]+/, { timeout: 15000 });
	const match = page.url().match(/\/draft\/([^/?#]+)/);
	return decodeURIComponent(match?.[1] ?? '');
}

/**
 * Flush the open editor's buffer.
 *
 * The editor header has no Save button — autosave owns the save path and the
 * dirty dot on the title reports it — so a spec that needs the buffer on the
 * server presses the manual-flush shortcut instead of waiting out the ten
 * second autosave. Clicking the body first puts focus inside the editor, which
 * is where the shortcut is bound.
 */
export async function saveEditor(page: Page) {
	await page.locator('.ProseMirror').first().click();
	await page.keyboard.press('ControlOrMeta+s');
}
