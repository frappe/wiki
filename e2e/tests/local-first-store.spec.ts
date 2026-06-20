import { expect, test } from '@playwright/test';
import { callMethod } from '../helpers/frappe';
import { delayMethod, failMethod } from '../helpers/mock';

interface DraftNode {
	docKey: string;
	title: string;
	children: DraftNode[];
}

// `wikiEditor` is already declared globally by other specs (e.g.
// iframe-embed.spec.ts). Only extend with what's specific to this file.
declare global {
	interface Window {
		__draftStore: {
			tree: DraftNode[];
			rootKey: string | null;
			crName: string | null;
			pagesByKey: Record<string, { content?: string | null }>;
			moveNode: (args: {
				docKey: string;
				newParentKey: string | null;
				newIndex: number;
			}) => void;
		};
	}
}

/**
 * E2E coverage for the local-first draft workspace store.
 *
 * These specs deliberately inject latency or failure on the batch sync
 * endpoint (`apply_cr_operations`) to verify that the optimistic UI does
 * not regress: pages appear before the backend confirms, typed content
 * survives temp-key promotion, failed saves keep local state visible, and
 * submit/merge are blocked while mutations are pending or failed.
 *
 * See specs/local_first_editor_migration_step_2.md.
 */

const CR_METHOD_PREFIX =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

async function createSpaceViaUI(
	page: import('@playwright/test').Page,
	{ name, route }: { name: string; route: string },
) {
	await page.goto('/wiki/spaces');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'New Space' }).click();
	await page.waitForSelector('[role="dialog"]', { state: 'visible' });
	await page.getByLabel('Space Name').fill(name);
	await page.getByLabel('Route').fill(route);
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Create' })
		.click();
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/\/wiki\/spaces\//);
	// `networkidle` can fire before draftStore.hydrate finishes setting
	// rootKey. Without this wait, the create dialog falls back to
	// `space.doc.root_group` (a Frappe document name) instead of the CR's
	// doc_key, and the optimistic insert silently no-ops.
	await page.waitForFunction(() => Boolean(window.__draftStore?.rootKey), {
		timeout: 10000,
	});
	const spaceId = page.url().split('/wiki/spaces/')[1];
	return { spaceId };
}

async function createPageViaUI(
	page: import('@playwright/test').Page,
	title: string,
) {
	const createFirstPage = page.getByRole('button', {
		name: 'Create First Page',
	});
	const newPageButton = page.getByRole('button', { name: 'New Page' });
	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await newPageButton.click();
	}
	await page.getByLabel('Title').fill(title);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
}

test.describe('Local-first draft workspace', () => {
	test('delayed apply_cr_operations create: page appears immediately and content survives promotion', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Delay Create Space ${timestamp}`;
		const spaceRoute = `delay-create-space-${timestamp}`;
		const pageTitle = `delay-create-page-${timestamp}`;
		const typedContent = `Typed before backend confirmed ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });

		// Inject 2.5s of latency on apply_cr_operations so the optimistic UI
		// is observable for the full duration before the temp key is promoted.
		const unroute = await delayMethod(
			page,
			`${CR_METHOD_PREFIX}.apply_cr_operations`,
			2500,
		);

		await createPageViaUI(page, pageTitle);

		// Sidebar entry must be visible well before the create RPC resolves.
		// The dialog also auto-navigates to /draft/<tmpKey>, so we don't need
		// to click the sidebar entry — just verify both signals.
		const sidebarEntry = page
			.locator('aside')
			.getByText(pageTitle, { exact: true });
		await expect(sidebarEntry).toBeVisible({ timeout: 1500 });
		await page.waitForURL(/\/draft\/tmp_[^/?#]+/, { timeout: 2000 });

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 5000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 5000,
		});
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();

		// Wait for the create RPC to actually resolve and the temp key to be
		// swapped out for the real one.
		await page.waitForFunction(
			() => {
				const draftKey = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!draftKey) return false;
				return !decodeURIComponent(draftKey[1]).startsWith('tmp_');
			},
			{ timeout: 6000 },
		);

		// Typed content must still be in the editor after the key swap.
		await expect(page.getByText(typedContent)).toBeVisible();

		// Promotion triggers a save against the real key. Let that intercepted
		// request finish before unregistering its delayed route handler.
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 6000,
		});
		await unroute();
	});

	test('failed apply_cr_operations save: content stays visible and submit is blocked', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Fail Update Space ${timestamp}`;
		const spaceRoute = `fail-update-space-${timestamp}`;
		const pageTitle = `fail-update-page-${timestamp}`;
		const typedContent = `Should survive failed save ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		// Wait for the URL to land on a real (non-temp) key so we don't
		// accidentally fail the auto-save that fires when a temp key is
		// promoted.
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Fail every apply_cr_operations from this point onward. The create
		// op already completed (URL is on the real key), so this only affects
		// the user's manual save.
		await failMethod(
			page,
			`${CR_METHOD_PREFIX}.apply_cr_operations`,
			'Mocked save failure',
		);

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();

		// Sync-state badge should report failure.
		await expect(page.getByText('Sync failed')).toBeVisible({
			timeout: 5000,
		});

		// User's typed content must still be in the editor.
		await expect(page.getByText(typedContent)).toBeVisible();

		// Submit for Review must be disabled while there are failed mutations.
		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeVisible();
		await expect(submitButton).toBeDisabled();
	});

	test('Reload latest after a failed save clears the conflict and re-enables Submit', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Reload Latest Space ${timestamp}`;
		const spaceRoute = `reload-latest-space-${timestamp}`;
		const pageTitle = `reload-latest-page-${timestamp}`;
		const typedContent = `Will fail to save ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const unroute = await failMethod(
			page,
			`${CR_METHOD_PREFIX}.apply_cr_operations`,
			'Mocked save failure',
		);
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();

		// The save fails; banner surfaces it and Reload latest appears.
		await expect(page.getByText('Sync failed')).toBeVisible({ timeout: 5000 });
		const reloadButton = page.getByRole('button', { name: 'Reload latest' });
		await expect(reloadButton).toBeVisible();

		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeDisabled();

		// Drop the failure interceptor so the reload's get_cr_tree / load_changes
		// calls go through (Reload latest only refetches read-side state — it
		// does not retry the failed batch).
		await unroute();
		await reloadButton.click();

		// Sync-failed banner clears and the recovery button hides — but
		// Submit MUST stay disabled because the editor's DOM still holds
		// the user's unsaved typed content. Unblocking here would let the
		// user submit a CR that doesn't contain what they see on screen.
		await expect(page.getByText('Sync failed')).toBeHidden({ timeout: 5000 });
		await expect(reloadButton).toBeHidden();
		await expect(submitButton).toBeDisabled();

		// Resolving the typed content (Save now succeeds because the
		// mock is gone and operation_version is fresh) is what finally
		// re-enables Submit.
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});
		await expect(submitButton).toBeEnabled();
	});

	test('typing in editor disables Submit until the change is flushed to the CR', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Dirty Editor Space ${timestamp}`;
		const spaceRoute = `dirty-editor-space-${timestamp}`;
		const pageTitle = `dirty-editor-page-${timestamp}`;
		const typedContent = `Must not be dropped by submit ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		// Wait until we're on a real key so any prior pending mutations are done.
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		// Baseline: nothing pending, Submit is enabled.
		await expect(submitButton).toBeEnabled({ timeout: 5000 });

		// Type into the editor. Autosave is debounced 10s, so the change is
		// purely local — no apply_cr_operations call is in flight yet.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();

		// The fix: Submit must be disabled while the editor has unsaved
		// typed content the store hasn't received yet. Without it, the user
		// can submit a stale backend CR and silently lose the latest text.
		await expect(submitButton).toBeDisabled();

		// Flushing via manual Save lands the content and re-enables Submit.
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});
		await expect(submitButton).toBeEnabled();
	});

	test('navigating away from dirty content keeps Submit disabled and restores the local buffer', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Navigate Dirty Space ${timestamp}`;
		const spaceRoute = `navigate-dirty-space-${timestamp}`;
		const firstTitle = `navigate-first-page-${timestamp}`;
		const secondTitle = `navigate-second-page-${timestamp}`;
		const typedContent = `Must survive document navigation ${timestamp}`;

		const { spaceId } = await createSpaceViaUI(page, {
			name: spaceName,
			route: spaceRoute,
		});
		const draft = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_or_create_draft_change_request`,
			{ wiki_space: spaceId },
		);
		const tree = await callMethod<{ root_group: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_cr_tree`,
			{ name: draft.name },
		);
		const firstKey = await callMethod<string>(
			request,
			`${CR_METHOD_PREFIX}.create_cr_page`,
			{
				name: draft.name,
				parent_key: tree.root_group,
				title: firstTitle,
				content: '',
				is_group: 0,
				is_published: 1,
			},
		);
		await callMethod(request, `${CR_METHOD_PREFIX}.create_cr_page`, {
			name: draft.name,
			parent_key: tree.root_group,
			title: secondTitle,
			content: '',
			is_group: 0,
			is_published: 1,
		});

		await page.goto(`/wiki/spaces/${spaceId}/draft/${firstKey}`);
		await page.waitForLoadState('networkidle');

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled();
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();
		await expect(submitButton).toBeDisabled();

		await page.locator('aside').getByText(secondTitle, { exact: true }).click();
		await expect(submitButton).toBeDisabled();

		await page.locator('aside').getByText(firstTitle, { exact: true }).click();
		await expect(page.getByText(typedContent)).toBeVisible({ timeout: 5000 });
		await expect(submitButton).toBeDisabled();

		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});
		await expect(submitButton).toBeEnabled();
	});

	test('typing then undoing back to saved content re-enables Submit without a redundant save', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Undo Editor Space ${timestamp}`;
		const spaceRoute = `undo-editor-space-${timestamp}`;
		const pageTitle = `undo-editor-page-${timestamp}`;
		const baselineContent = `Baseline ${timestamp}`;
		const transientContent = `Transient typing ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Establish a saved baseline so we have something to undo *back to*.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, baselineContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});

		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled();

		// Type something new — Submit should go disabled.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, transientContent);
		await editor.click();
		await expect(submitButton).toBeDisabled();

		// Revert back to the saved content. No save is issued; the derived
		// local snapshot converges with the baseline and the banner gate
		// releases on its own.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, baselineContent);
		await editor.click();
		await expect(submitButton).toBeEnabled();
	});

	test('dirty content on an existing published page survives browser refresh', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Published Persist Space ${timestamp}`;
		const spaceRoute = `published-persist-space-${timestamp}`;
		const pageTitle = `published-persist-page-${timestamp}`;
		const typedContent = `Existing page survives refresh ${timestamp}`;

		const { spaceId } = await createSpaceViaUI(page, {
			name: spaceName,
			route: spaceRoute,
		});
		const initialDraft = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_or_create_draft_change_request`,
			{ wiki_space: spaceId },
		);
		const initialTree = await callMethod<{ root_group: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_cr_tree`,
			{ name: initialDraft.name },
		);
		await callMethod(request, `${CR_METHOD_PREFIX}.create_cr_page`, {
			name: initialDraft.name,
			parent_key: initialTree.root_group,
			title: pageTitle,
			content: '',
			is_group: 0,
			is_published: 1,
		});
		await callMethod(request, `${CR_METHOD_PREFIX}.submit_change_request`, {
			name: initialDraft.name,
		});
		// Merge requires an explicit Approved decision, so approve first.
		await callMethod(request, `${CR_METHOD_PREFIX}.approve_change_request`, {
			name: initialDraft.name,
		});
		await callMethod(request, `${CR_METHOD_PREFIX}.merge_change_request`, {
			name: initialDraft.name,
		});

		await page.goto(`/wiki/spaces/${spaceId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/page\/[^/?#]+/, { timeout: 10000 });

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();
		await page.waitForTimeout(800);

		await page.reload();
		await page.waitForLoadState('networkidle');

		await expect(page.getByText(typedContent)).toBeVisible({ timeout: 10000 });
		await expect(page.getByText('Unsaved changes')).toBeVisible({
			timeout: 5000,
		});

		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});
		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled();
	});

	test('dirty editor content survives a browser refresh via IndexedDB', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Persist Space ${timestamp}`;
		const spaceRoute = `persist-space-${timestamp}`;
		const pageTitle = `persist-page-${timestamp}`;
		const typedContent = `Survives a refresh ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Type into the editor and let the LOCAL_PERSIST_DELAY (500ms)
		// debounce settle. Crucially we do NOT save — Submit-blocking and
		// IDB persistence both have to work entirely off the typing event.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, typedContent);
		await editor.click();
		await page.waitForTimeout(800);

		// Hard refresh the tab. In-memory state (Vue refs, pinia store)
		// is wiped; only IndexedDB-backed drafts survive.
		await page.reload();
		await page.waitForLoadState('networkidle');

		// Navigate back to the draft page. The editor should reopen on the
		// same content the user last typed, and the banner should report
		// "Unsaved changes" with Submit still gated.
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		const restoredEditor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(restoredEditor).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(typedContent)).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Unsaved changes')).toBeVisible({
			timeout: 5000,
		});

		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeDisabled();

		// Saving the restored draft clears the IDB entry and re-enables
		// Submit, just like a normal first-save.
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});
		await expect(submitButton).toBeEnabled();
	});

	test('a persisted draft identical to the server self-heals instead of gating Submit', async ({
		page,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Phantom Draft Space ${timestamp}`;
		const spaceRoute = `phantom-draft-space-${timestamp}`;
		const pageTitle = `phantom-draft-page-${timestamp}`;
		const savedContent = `Already on the server ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);

		const editor = page
			.locator('.ProseMirror, [contenteditable="true"]')
			.first();
		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// Save baseline content so the server holds a confirmed copy.
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, savedContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 5000,
		});

		// Plant a persisted IndexedDB draft whose content is byte-identical to
		// what the server already holds — a phantom with no real unsaved
		// changes (the shape an earlier non-idempotent markdown round-trip left
		// behind). Restoring it as dirty would gate Submit/Merge on every
		// hydrate and survive an IndexedDB clear once re-persisted.
		const planted = await page.evaluate(async () => {
			const store = window.__draftStore;
			const crName = store.crName;
			const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
			const docKey = match ? decodeURIComponent(match[1]) : null;
			if (!crName || !docKey) return null;
			const serverContent = store.pagesByKey[docKey]?.content ?? '';
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.open('wiki-drafts');
				req.onupgradeneeded = () => req.result.createObjectStore('drafts');
				req.onsuccess = () => {
					const tx = req.result
						.transaction('drafts', 'readwrite')
						.objectStore('drafts');
					const put = tx.put(
						{ content: serverContent, title: '', savedAt: 1 },
						`cr:${crName}:${docKey}`,
					);
					put.onsuccess = () => resolve();
					put.onerror = () => reject(put.error);
				};
				req.onerror = () => reject(req.error);
			});
			return { crName, docKey };
		});
		if (!planted) throw new Error('Failed to plant phantom draft in IndexedDB');
		const idbKey = `cr:${planted.crName}:${planted.docKey}`;

		// Reload: in-memory state is wiped and hydrate runs
		// restorePersistedDrafts, which must verify the draft against the
		// server and drop it rather than reseeding dirty state.
		await page.reload();
		await page.waitForLoadState('networkidle');

		// The banner must not report unsaved changes; Submit stays enabled.
		const submitButton = page.getByRole('button', {
			name: 'Submit for Review',
		});
		await expect(submitButton).toBeEnabled({ timeout: 10000 });
		await expect(page.getByText('Unsaved changes')).toBeHidden();

		// And the phantom entry must be gone from IndexedDB so it can't
		// resurface on a later hydrate.
		await expect
			.poll(
				() =>
					page.evaluate(
						(key) =>
							new Promise<boolean>((resolve) => {
								const req = indexedDB.open('wiki-drafts');
								req.onsuccess = () => {
									const db = req.result;
									if (!db.objectStoreNames.contains('drafts')) {
										return resolve(false);
									}
									db
										.transaction('drafts')
										.objectStore('drafts')
										.getAllKeys().onsuccess = (e) =>
										resolve(
											(e.target as IDBRequest<IDBValidKey[]>).result.includes(
												key,
											),
										);
								};
								req.onerror = () => resolve(false);
							}),
						idbKey,
					),
				{ timeout: 5000 },
			)
			.toBe(false);
	});

	test('a restored draft matching normalized server markdown self-heals after editor mount', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Normalized Draft Space ${timestamp}`;
		const spaceRoute = `normalized-draft-space-${timestamp}`;
		const pageTitle = `normalized-draft-page-${timestamp}`;
		const rawServerContent = `Line A ${timestamp}\nLine B`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const planted = await page.evaluate(async (rawContent) => {
			const store = window.__draftStore;
			const crName = store.crName;
			const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
			const docKey = match ? decodeURIComponent(match[1]) : null;
			const manager = (
				window.wikiEditor as typeof window.wikiEditor & {
					markdown?: {
						parse: (content: string) => unknown;
						serialize: (doc: unknown) => string;
					};
				}
			).markdown;
			if (!crName || !docKey || !manager) return null;
			const normalizedContent = manager.serialize(manager.parse(rawContent));
			if (normalizedContent === rawContent) return null;
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.open('wiki-drafts');
				req.onupgradeneeded = () => req.result.createObjectStore('drafts');
				req.onsuccess = () => {
					const put = req.result
						.transaction('drafts', 'readwrite')
						.objectStore('drafts')
						.put(
							{ content: normalizedContent, title: '', savedAt: 1 },
							`cr:${crName}:${docKey}`,
						);
					put.onsuccess = () => resolve();
					put.onerror = () => reject(put.error);
				};
				req.onerror = () => reject(req.error);
			});
			return { crName, docKey, normalizedContent };
		}, rawServerContent);
		if (!planted) throw new Error('Expected markdown normalization to differ');

		await callMethod(request, `${CR_METHOD_PREFIX}.update_cr_page`, {
			name: planted.crName,
			doc_key: planted.docKey,
			fields: { content: rawServerContent },
		});

		await page.reload();
		await page.waitForLoadState('networkidle');
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		// The persisted text and server text differ byte-for-byte, but Tiptap
		// normalizes them to the same document. Mount reconciliation must clear
		// the phantom draft instead of keeping Submit/Merge gated.
		await expect(page.getByText('Unsaved changes')).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Submit for Review' }),
		).toBeEnabled();
	});

	test('saving again while the first save is in flight persists the latest content', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Queued Save Space ${timestamp}`;
		const spaceRoute = `queued-save-space-${timestamp}`;
		const pageTitle = `queued-save-page-${timestamp}`;
		const firstContent = `First save ${timestamp}`;
		const latestContent = `Latest save ${timestamp}`;

		await createSpaceViaUI(page, { name: spaceName, route: spaceRoute });
		await createPageViaUI(page, pageTitle);
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForFunction(
			() => {
				const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
				if (!match) return false;
				return !decodeURIComponent(match[1]).startsWith('tmp_');
			},
			{ timeout: 10000 },
		);
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});

		const unroute = await delayMethod(
			page,
			`${CR_METHOD_PREFIX}.apply_cr_operations`,
			1500,
		);
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, firstContent);
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Saving…')).toBeVisible();

		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, latestContent);
		await page.keyboard.press('Control+s');

		await expect(page.getByText('All changes saved')).toBeVisible({
			timeout: 8000,
		});
		await unroute();

		const { crName, docKey } = await page.evaluate(() => {
			const match = window.location.pathname.match(/\/draft\/([^/?#]+)/);
			return {
				crName: window.__draftStore.crName,
				docKey: match ? decodeURIComponent(match[1]) : null,
			};
		});
		if (!crName || !docKey) throw new Error('Draft page identity is missing');
		const savedPage = await callMethod<{ content: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_cr_page`,
			{ name: crName, doc_key: docKey },
		);
		expect(savedPage.content).toBe(latestContent);
	});

	test('delayed reorder: visual order stays stable across slow sync', async ({
		page,
		request,
	}) => {
		const timestamp = Date.now();
		const spaceName = `Delay Reorder Space ${timestamp}`;
		const spaceRoute = `delay-reorder-space-${timestamp}`;
		const groupTitle = `Reorder Group ${timestamp}`;
		const pageTitles = ['1', '2', '3', '4'].map(
			(n) => `Reorder Page ${n} ${timestamp}`,
		);

		const { spaceId } = await createSpaceViaUI(page, {
			name: spaceName,
			route: spaceRoute,
		});

		// Seed a group with 4 pages directly via the existing CR APIs so the
		// test focuses on the reorder behaviour, not creation.
		const draft = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_or_create_draft_change_request`,
			{ wiki_space: spaceId },
		);
		const tree = await callMethod<{ root_group: string }>(
			request,
			`${CR_METHOD_PREFIX}.get_cr_tree`,
			{ name: draft.name },
		);
		const groupKey = await callMethod<string>(
			request,
			`${CR_METHOD_PREFIX}.create_cr_page`,
			{
				name: draft.name,
				parent_key: tree.root_group,
				title: groupTitle,
				content: '',
				is_group: 1,
				is_published: 1,
			},
		);
		for (const title of pageTitles) {
			await callMethod(request, `${CR_METHOD_PREFIX}.create_cr_page`, {
				name: draft.name,
				parent_key: groupKey,
				title,
				content: '',
				is_group: 0,
				is_published: 1,
			});
		}

		await page.goto(`/wiki/spaces/${spaceId}`);
		await page.waitForLoadState('networkidle');
		await page.locator('aside').getByText(groupTitle, { exact: true }).click();
		for (const title of pageTitles) {
			await expect(
				page.locator('aside').getByText(title, { exact: true }),
			).toBeVisible();
		}

		await page.waitForFunction(() => window.__draftStore !== undefined, {
			timeout: 5000,
		});

		// Locate the doc_key of the page we want to move (first → third slot).
		const movedTitle = pageTitles[0];
		const movedDocKey = await page.evaluate((title) => {
			type Node = {
				title: string;
				docKey: string;
				children?: Node[];
			};
			const findInTree = (nodes: Node[] = []): string | null => {
				for (const node of nodes) {
					if (node.title === title) return node.docKey;
					const child = findInTree(node.children);
					if (child) return child;
				}
				return null;
			};
			return findInTree(window.__draftStore.tree as Node[]);
		}, movedTitle);
		if (!movedDocKey)
			throw new Error('Could not locate doc_key for moved page');

		// Inject latency on apply_cr_operations so the optimistic order is
		// observable while the backend round-trips. Move + reorder ride in
		// one batch.
		const unrouteBatch = await delayMethod(
			page,
			`${CR_METHOD_PREFIX}.apply_cr_operations`,
			2500,
		);

		await page.evaluate(
			({ docKey, parentKey }) => {
				window.__draftStore.moveNode({
					docKey,
					newParentKey: parentKey,
					newIndex: 2,
				});
			},
			{ docKey: movedDocKey, parentKey: groupKey },
		);

		// Reads sidebar text in order; titles unique enough that index ordering
		// reflects DOM order.
		const readOrder = async () => {
			const sidebarText = await page.locator('aside').innerText();
			return pageTitles
				.map((t) => ({ t, idx: sidebarText.indexOf(t) }))
				.filter((x) => x.idx >= 0)
				.sort((a, b) => a.idx - b.idx)
				.map((x) => x.t);
		};

		const expectedOrder = [
			pageTitles[1],
			pageTitles[2],
			pageTitles[0],
			pageTitles[3],
		];

		// Optimistic order must be in place before the backend resolves.
		await expect.poll(readOrder, { timeout: 1500 }).toEqual(expectedOrder);

		// Wait past the injected latency and re-check; optimistic order must
		// not snap back when the backend finally responds.
		await page.waitForTimeout(3500);
		expect(await readOrder()).toEqual(expectedOrder);

		await unrouteBatch();
	});
});
