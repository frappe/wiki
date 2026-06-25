import { APIRequestContext, type Page, expect } from '@playwright/test';
import { createDoc, deleteDoc, getDoc, getList } from './frappe';

/**
 * Tear down every Wiki Space with the given (test-unique) route.
 *
 * `Wiki Space` cascades its documents, revisions and root group on delete (see
 * its `on_trash`), so a single atomic `deleteDoc` removes the whole space —
 * important for a git-synced space, which is read-only and otherwise lingers as
 * the newest entry in the `/wiki` list (ordered by creation desc), trapping
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
