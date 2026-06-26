import { type Page, expect, test } from '@playwright/test';
import { callMethod, getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

/**
 * Self-serve publish from the review page: the combined "Approve & Merge" now
 * lives in the three-dots menu (the header primary button is Approve-only). It
 * opens a confirm dialog whose action button is also "Approve & Merge".
 */
async function approveAndMergeFromReview(page: Page) {
	await clickReviewMenuItem(page, 'Approve & Merge');
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Approve & Merge', exact: true })
		.click();
	await expect(page.locator('text=Change request merged').first()).toBeVisible({
		timeout: 15000,
	});
}

/** Open the three-dots review menu and click one of its items. */
async function clickReviewMenuItem(page: Page, name: string) {
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name }).click();
}

/**
 * Create a fresh space with a single draft page. Returns identifiers the
 * caller needs to navigate back to the space and address the page.
 */
async function createSpaceWithDraftPage(page: Page, label: string) {
	await page.goto('/wiki/spaces');
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'New Space' }).click();
	await page.waitForSelector('[role="dialog"]', { state: 'visible' });

	const timestamp = Date.now();
	const spaceName = `${label} ${timestamp}`;
	const spaceRoute = `${label.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`;
	const pageTitle = `${label
		.toLowerCase()
		.replace(/\s+/g, '-')}-page-${timestamp}`;

	await page.getByLabel('Space Name').fill(spaceName);
	await page.getByLabel('Route').fill(spaceRoute);
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Create' })
		.click();
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/\/wiki\/spaces\//);
	const spaceUrl = page.url();

	const createFirstPage = page.getByRole('button', {
		name: 'Create First Page',
	});
	const newPageButton = page.getByRole('button', { name: 'New Page' });
	if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
		await createFirstPage.click();
	} else {
		await newPageButton.click();
	}
	await page.getByLabel('Title').fill(pageTitle);
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(500);

	await page.locator('aside').getByText(pageTitle, { exact: true }).click();
	await page.waitForURL(/\/draft\/[^/?#]+/);

	return { spaceUrl, spaceName, pageTitle };
}

/** Set the open editor's content via the exposed wikiEditor and save. */
async function setEditorContentAndSave(page: Page, content: string) {
	const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
	await expect(editor).toBeVisible({ timeout: 10000 });
	await page.waitForFunction(() => window.wikiEditor !== undefined, {
		timeout: 10000,
	});
	await page.evaluate((c) => {
		window.wikiEditor.commands.setContent(c, { contentType: 'markdown' });
	}, content);
	await editor.click();
	await page.getByRole('button', { name: 'Save' }).click();
	await page.waitForTimeout(500);
}

/** Submit the current draft for review; returns the change-request name. */
async function submitForReviewFromEditor(page: Page) {
	await page.getByRole('button', { name: 'Submit for Review' }).click();
	await page
		.getByRole('dialog')
		.getByRole('button', { name: 'Submit', exact: true })
		.click();
	await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
		timeout: 10000,
	});
	return decodeURIComponent(page.url().split('/').pop() as string);
}

test.describe('Change Request Flow', () => {
	test('should add a page, edit existing page, merge, and verify live content', async ({
		page,
		request,
	}) => {
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		// Create a new space
		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });

		const timestamp = Date.now();
		const spaceName = `CR Flow Space ${timestamp}`;
		const spaceRoute = `cr-flow-space-${timestamp}`;
		const pageTitle = `cr-flow-page-${timestamp}`;
		const initialContent = `Initial content ${timestamp}`;
		const updatedContent = `Updated content ${timestamp}`;

		await page.getByLabel('Space Name').fill(spaceName);
		const routeInput = page.getByLabel('Route');
		await routeInput.fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		const spaceUrl = page.url();

		// Create a new page draft
		const createFirstPage = page.getByRole('button', {
			name: 'Create First Page',
		});
		const newPageButton = page.getByRole('button', { name: 'New Page' });

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForTimeout(500);

		// Open the new draft page from the tree
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const draftMatch = page.url().match(/\/draft\/([^/?#]+)/);
		expect(draftMatch).toBeTruthy();
		const docKey = decodeURIComponent(draftMatch?.[1] ?? '');
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
		}, initialContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();
		await page.waitForTimeout(500);

		// Submit for review and merge
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});

		await approveAndMergeFromReview(page);

		// Verify merged content on live route
		const routes = await getList<WikiDocumentRoute>(request, 'Wiki Document', {
			fields: ['route', 'doc_key'],
			filters: { doc_key: docKey },
			limit: 1,
		});
		expect(routes.length).toBe(1);
		const publicRoute = routes[0].route;
		await page.goto(`/${publicRoute}`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByText(initialContent)).toBeVisible({
			timeout: 10000,
		});

		// Start a new CR by editing the existing page
		await page.goto(spaceUrl);
		await page.waitForLoadState('networkidle');
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await expect(editor).toBeVisible({ timeout: 10000 });

		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});
		await page.evaluate((content) => {
			window.wikiEditor.commands.setContent(content, {
				contentType: 'markdown',
			});
		}, `${initialContent}\n\n${updatedContent}`);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();
		await page.waitForTimeout(500);

		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});

		await approveAndMergeFromReview(page);

		// Verify updated content on live route
		const updatedRoutes = await getList<WikiDocumentRoute>(
			request,
			'Wiki Document',
			{
				fields: ['route', 'doc_key'],
				filters: { doc_key: docKey },
				limit: 1,
			},
		);
		expect(updatedRoutes.length).toBe(1);
		const updatedRoute = updatedRoutes[0].route;
		await page.goto(`/${updatedRoute}`);
		await page.waitForLoadState('networkidle');
		await expect(page.getByText(updatedContent)).toBeVisible({
			timeout: 10000,
		});
	});

	test('should merge multiple change requests with added folders and pages', async ({
		page,
		request,
	}) => {
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		// Create a new space
		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });

		const timestamp = Date.now();
		const spaceName = `CR Multi Space ${timestamp}`;
		const spaceRoute = `cr-multi-space-${timestamp}`;

		await page.getByLabel('Space Name').fill(spaceName);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		const spaceUrl = page.url();
		const spaceId = spaceUrl.split('/wiki/spaces/')[1];

		const createGroup = async (title: string) => {
			await page.locator('button[title="New Group"]').click();
			await page.getByRole('dialog').getByLabel('Title').fill(title);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save' })
				.click();
			await page.waitForSelector(`aside >> text=${title}`, {
				timeout: 10000,
			});
		};

		const addPageToGroup = async (groupTitle: string, pageTitle: string) => {
			const groupItem = page
				.locator('aside .draggable-item', { hasText: groupTitle })
				.first();
			await groupItem.hover();
			// Click the three-dot menu button (in the row, not in nested content)
			await groupItem.locator('> div').first().locator('button').last().click();
			await page.getByRole('menuitem', { name: 'Add Page' }).click();
			await page.getByRole('dialog').getByLabel('Title').fill(pageTitle);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save' })
				.click();
			const pageEntry = page
				.locator('aside')
				.getByText(pageTitle, { exact: true });
			await pageEntry.waitFor({ state: 'attached', timeout: 10000 });
			if (!(await pageEntry.isVisible())) {
				await page
					.locator('aside')
					.getByText(groupTitle, { exact: true })
					.click();
			}
			await expect(pageEntry).toBeVisible({ timeout: 10000 });
		};

		const submitChangeRequestForSpace = async () => {
			const draftChangeRequest = await callMethod<{ name: string }>(
				request,
				`${CR_METHOD}.get_or_create_draft_change_request`,
				{ wiki_space: spaceId },
			);
			await callMethod(request, `${CR_METHOD}.submit_change_request`, {
				name: draftChangeRequest.name,
			});
			return `/wiki/change-requests/${draftChangeRequest.name}`;
		};

		// Approve via API (the two-person split), then exercise the plain Merge
		// button that the review page shows once a CR is Approved.
		const mergeChangeRequest = async (url: string) => {
			const name = url.split('/').pop() as string;
			await callMethod(request, `${CR_METHOD}.approve_change_request`, {
				name,
			});
			await page.goto(url);
			await page.getByRole('button', { name: 'Merge', exact: true }).click();
			await expect(
				page.locator('text=Change request merged').first(),
			).toBeVisible({ timeout: 15000 });
		};

		// Change request 1
		const cr1GroupA = `CR1 Folder A ${timestamp}`;
		const cr1GroupB = `CR1 Folder B ${timestamp}`;
		const cr1Page = `CR1 Page ${timestamp}`;

		await createGroup(cr1GroupA);
		await createGroup(cr1GroupB);
		await addPageToGroup(cr1GroupA, cr1Page);

		const cr1Url = await submitChangeRequestForSpace();

		// Change request 2 (created after CR1 is submitted)
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');
		await page.getByText(spaceName, { exact: true }).click();
		await page.waitForLoadState('networkidle');

		const cr2GroupA = `CR2 Folder A ${timestamp}`;
		const cr2GroupB = `CR2 Folder B ${timestamp}`;
		const cr2Page = `CR2 Page ${timestamp}`;

		await createGroup(cr2GroupA);
		await createGroup(cr2GroupB);
		await addPageToGroup(cr2GroupA, cr2Page);

		const cr2Url = await submitChangeRequestForSpace();

		// Merge both change requests
		await mergeChangeRequest(cr1Url);
		await mergeChangeRequest(cr2Url);

		// Verify merged tree contains all folders and pages
		type TreeNode = {
			title?: string;
			children?: TreeNode[];
		};

		const tree = await callMethod<{ children: TreeNode[] }>(
			request,
			'wiki.api.wiki_space.get_wiki_tree',
			{ space_id: spaceId },
		);

		const titles = new Set<string>();
		const collectTitles = (nodes: TreeNode[] = []) => {
			for (const node of nodes) {
				if (node?.title) titles.add(node.title);
				if (node?.children?.length) collectTitles(node.children);
			}
		};
		collectTitles(tree?.children || []);

		const expectedTitles = [
			cr1GroupA,
			cr1GroupB,
			cr1Page,
			cr2GroupA,
			cr2GroupB,
			cr2Page,
		];

		for (const title of expectedTitles) {
			expect(titles.has(title)).toBeTruthy();
		}
	});

	test('should label reordered pages when reordering within a group', async ({
		page,
		request,
	}) => {
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		const timestamp = Date.now();
		const spaceName = `CR Reorder Space ${timestamp}`;
		const spaceRoute = `cr-reorder-space-${timestamp}`;

		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceName);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		const spaceId = page.url().split('/wiki/spaces/')[1];

		const groupTitle = `Reorder Group ${timestamp}`;

		const pageTitles = ['1', '2', '3', '4', '5'].map(
			(number) => `Reorder Page ${number} ${timestamp}`,
		);

		const initialDraft = await callMethod<{ name: string }>(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_or_create_draft_change_request',
			{ wiki_space: spaceId },
		);
		const initialTree = await callMethod<{ root_group?: string }>(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
			{ name: initialDraft.name },
		);
		expect(initialTree.root_group).toBeTruthy();
		const groupKey = await callMethod<string>(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.create_cr_page',
			{
				name: initialDraft.name,
				parent_key: initialTree.root_group,
				title: groupTitle,
				content: '',
				is_group: 1,
				is_published: 1,
			},
		);
		for (const pageTitle of pageTitles) {
			await callMethod(
				request,
				'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.create_cr_page',
				{
					name: initialDraft.name,
					parent_key: groupKey,
					title: pageTitle,
					content: '',
					is_group: 0,
					is_published: 1,
				},
			);
		}

		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: initialDraft.name,
		});
		await callMethod(request, `${CR_METHOD}.approve_change_request`, {
			name: initialDraft.name,
		});
		await callMethod(request, `${CR_METHOD}.merge_change_request`, {
			name: initialDraft.name,
		});

		// Start a new change request and reorder pages inside the group
		const draftResponsePromise = page.waitForResponse((response) => {
			if (
				!response
					.url()
					.includes(
						'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_or_create_draft_change_request',
					)
			) {
				return false;
			}
			if (response.request().method() !== 'POST') {
				return false;
			}
			const postData = response.request().postData() || '';
			return postData.includes(spaceId);
		});

		await page.goto(`/wiki/spaces/${spaceId}`);
		await page.waitForLoadState('networkidle');

		const draftResponse = await draftResponsePromise;
		const draftPayload = await draftResponse.json();
		const draftChangeRequest = draftPayload?.message as { name: string };
		expect(draftChangeRequest?.name).toBeTruthy();

		type CrTreeNode = {
			title?: string;
			doc_key?: string;
			children?: CrTreeNode[];
		};

		const crTree = await callMethod<{ children: CrTreeNode[] }>(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_cr_tree',
			{ name: draftChangeRequest.name },
		);

		const findNode = (
			nodes: CrTreeNode[],
			title: string,
		): CrTreeNode | null => {
			for (const node of nodes) {
				if (node?.title === title) {
					return node;
				}
				if (node?.children?.length) {
					const found = findNode(node.children, title);
					if (found) return found;
				}
			}
			return null;
		};

		const groupNode = findNode(crTree.children || [], groupTitle);
		expect(groupNode).toBeTruthy();
		expect(groupNode?.doc_key).toBeTruthy();
		const children = groupNode?.children || [];
		const keyByTitle = new Map(
			children
				.filter((child) => child.title && child.doc_key)
				.map((child) => [child.title as string, child.doc_key as string]),
		);

		const reorderedTitles = [
			pageTitles[1],
			pageTitles[0],
			pageTitles[2],
			pageTitles[3],
			pageTitles[4],
		];

		const orderedDocKeys = reorderedTitles.map((title) =>
			keyByTitle.get(title),
		);
		expect(orderedDocKeys.every(Boolean)).toBeTruthy();

		await callMethod(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.reorder_cr_children',
			{
				name: draftChangeRequest.name,
				parent_key: groupNode?.doc_key,
				ordered_doc_keys: orderedDocKeys as string[],
			},
		);

		await page.reload();
		await page.waitForLoadState('networkidle');

		// Ensure the group is expanded for assertions
		await page.locator('aside').getByText(groupTitle, { exact: true }).click();

		const sidebarText = await page.locator('aside').innerText();
		expect(sidebarText.indexOf(pageTitles[1])).toBeLessThan(
			sidebarText.indexOf(pageTitles[0]),
		);

		const movedTitle = pageTitles[1];
		const movedRow = page
			.locator('aside .draggable-item > div.flex')
			.filter({ has: page.getByText(movedTitle, { exact: true }) })
			.first();
		await expect(
			movedRow.getByText('Reordered', { exact: true }),
		).toBeVisible();
		await expect(movedRow.getByText('Modified', { exact: true })).toHaveCount(
			0,
		);

		// Submit for review and verify reordered badge in review list
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: draftChangeRequest.name,
		});
		await page.goto(`/wiki/change-requests/${draftChangeRequest.name}`);
		await page.waitForLoadState('networkidle');

		const changeCard = page
			.locator('div.border.border-outline-gray-2.rounded-lg.overflow-hidden')
			.filter({ has: page.getByText(movedTitle, { exact: true }) })
			.first();
		await expect(
			changeCard.getByText('Reordered', { exact: true }),
		).toBeVisible();

		// Expanding a reorder shows a structural before/after (its position changed)
		// rather than the content Diff/Preview toggle, which is meaningless here.
		await changeCard.getByText(movedTitle, { exact: true }).click();
		await expect(changeCard.getByRole('button', { name: 'Diff' })).toHaveCount(
			0,
		);
		await expect(
			changeCard.getByRole('button', { name: 'Preview' }),
		).toHaveCount(0);
		await expect(
			changeCard.getByText(/Position \d+ \/ \d+/).first(),
		).toBeVisible();
	});

	test('should navigate to published page after merging from space editor', async ({
		page,
		request,
	}) => {
		await page.goto('/wiki/spaces');
		await page.waitForLoadState('networkidle');

		const timestamp = Date.now();
		const spaceName = `CR Merge Nav Space ${timestamp}`;
		const spaceRoute = `cr-merge-nav-${timestamp}`;
		const pageTitle = `merge-nav-page-${timestamp}`;
		const pageContent = `Merge nav content ${timestamp}`;

		// Create a new space
		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });
		await page.getByLabel('Space Name').fill(spaceName);
		await page.getByLabel('Route').fill(spaceRoute);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(/\/wiki\/spaces\//);

		// Create a new page draft
		const createFirstPage = page.getByRole('button', {
			name: 'Create First Page',
		});
		const newPageButton = page.getByRole('button', { name: 'New Page' });

		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await newPageButton.click();
		}

		await page.getByLabel('Title').fill(pageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForTimeout(500);

		// Open the draft page from sidebar
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);

		// Add content
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
		}, pageContent);
		await editor.click();
		await page.getByRole('button', { name: 'Save' }).click();
		await page.waitForTimeout(500);

		// One-click self-serve publish from the editor: the Merge button walks
		// the CR through submit -> approve -> merge under the hood (a manager
		// merging their own draft needs no second person).
		const mergeButton = page.getByRole('button', { name: 'Merge' });
		await expect(mergeButton).toBeVisible({ timeout: 10000 });
		await mergeButton.click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		// The fix: after merge, URL should navigate to the published page route
		// and NOT remain on the /draft/ route
		await page.waitForURL(/\/page\//, { timeout: 10000 });
		expect(page.url()).toMatch(/\/spaces\/[^/]+\/page\//);
		expect(page.url()).not.toMatch(/\/draft\//);

		// The published page content should be visible without needing a hard refresh
		await expect(page.getByText(pageContent)).toBeVisible({
			timeout: 10000,
		});
	});

	test('two-person path: submit -> assign -> approve -> merge', async ({
		page,
		request,
	}) => {
		const content = `Two-person content ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Two Person');
		await setEditorContentAndSave(page, content);
		const crName = await submitForReviewFromEditor(page);

		// Assign a reviewer via the same endpoint the AssignDialog calls. Native
		// _assign/ToDo is the whole reviewer-discovery mechanism (no custom table).
		await callMethod(request, 'frappe.desk.form.assign_to.add', {
			doctype: 'Wiki Change Request',
			name: crName,
			assign_to: ['Administrator'],
		});
		const todos = await getList(request, 'ToDo', {
			filters: {
				reference_type: 'Wiki Change Request',
				reference_name: crName,
				allocated_to: 'Administrator',
				status: 'Open',
			},
			limit: 1,
		});
		expect(todos.length).toBe(1);

		// Approve as a decision only (two-person split) — no merge yet. Approve is
		// now the header primary action; merge happens afterwards.
		await page.reload();
		await page.waitForLoadState('networkidle');

		// The header must reflect the native _assign that frappe.client.get (the
		// document resource) omits — otherwise the assignee avatars never render.
		await expect(page.getByTestId('assignee-avatars').first()).toBeVisible();

		await page.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(page.getByText('Approved', { exact: true })).toBeVisible({
			timeout: 10000,
		});

		// Now the plain Merge button is available for the already-Approved CR.
		await page.getByRole('button', { name: 'Merge', exact: true }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		const merged = await getList<{ status: string }>(
			request,
			'Wiki Change Request',
			{ fields: ['status'], filters: { name: crName }, limit: 1 },
		);
		expect(merged[0]?.status).toBe('Merged');
	});

	test('request changes -> revise -> resubmit', async ({ page }) => {
		const content = `Request-changes content ${Date.now()}`;
		const feedback = `Please expand the intro ${Date.now()}`;
		const { spaceUrl, pageTitle } = await createSpaceWithDraftPage(
			page,
			'CR Request Changes',
		);
		await setEditorContentAndSave(page, content);
		await submitForReviewFromEditor(page);

		// Reviewer requests changes with required feedback.
		await clickReviewMenuItem(page, 'Request Changes');
		const rcDialog = page.getByRole('dialog');
		await rcDialog.getByRole('textbox').fill(feedback);
		await rcDialog
			.getByRole('button', { name: 'Request Changes', exact: true })
			.click();
		await expect(
			page.getByText('Changes Requested', { exact: true }),
		).toBeVisible({ timeout: 10000 });

		// Author returns to the editor; the banner surfaces the reviewer feedback
		// and the page is editable again.
		await page.goto(spaceUrl);
		await page.waitForLoadState('networkidle');
		await expect(page.getByText(feedback)).toBeVisible({ timeout: 10000 });

		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		await setEditorContentAndSave(page, `${content}\n\nRevised paragraph.`);

		// Resubmit: the CR goes back into review.
		await submitForReviewFromEditor(page);
		await expect(page.getByText('In Review', { exact: true })).toBeVisible({
			timeout: 10000,
		});
	});

	test('reject is terminal', async ({ page, request }) => {
		const content = `Reject content ${Date.now()}`;
		const reason = `Out of scope ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Reject');
		await setEditorContentAndSave(page, content);
		const crName = await submitForReviewFromEditor(page);

		await clickReviewMenuItem(page, 'Reject');
		const rejectDialog = page.getByRole('dialog');
		await rejectDialog.getByRole('textbox').fill(reason);
		await rejectDialog
			.getByRole('button', { name: 'Reject', exact: true })
			.click();
		await expect(page.getByText('Rejected', { exact: true })).toBeVisible({
			timeout: 10000,
		});

		// Terminal: no merge/approve actions remain, and a merge attempt is
		// rejected server-side.
		await expect(
			page.getByRole('button', { name: 'Approve', exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Merge', exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'More actions' }),
		).toHaveCount(0);

		let mergeThrew = false;
		try {
			await callMethod(request, `${CR_METHOD}.merge_change_request`, {
				name: crName,
			});
		} catch {
			mergeThrew = true;
		}
		expect(mergeThrew).toBe(true);
	});

	test('assigning from the list opens the dialog without navigating', async ({
		page,
	}) => {
		const content = `Assign nav content ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Assign Nav');
		await setEditorContentAndSave(page, content);
		await submitForReviewFromEditor(page);

		// The manager inbox renders an Assign action on every in-review row.
		await page.goto('/wiki/change-requests?tab=all');
		await page.waitForLoadState('networkidle');

		const assignButton = page.getByRole('button', { name: 'Assign' }).first();
		await expect(assignButton).toBeVisible({ timeout: 10000 });

		// Each row is a <router-link> (an <a>). Clicking Assign must not bubble
		// into the anchor navigation — the classic @click.stop-without-.prevent
		// regression where stopPropagation halts JS bubbling but the browser
		// still follows the row's href to the CR detail page.
		await assignButton.click();

		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
		await expect(page).toHaveURL(/\/wiki\/change-requests(\?.*)?$/);
	});

	test('assigned-to-me tab lists CRs assigned to the current user', async ({
		page,
		request,
	}) => {
		const content = `Assigned inbox content ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Assigned Inbox');
		await setEditorContentAndSave(page, content);
		const crName = await submitForReviewFromEditor(page);

		// Assign the CR to the session user (Administrator) via the same native
		// _assign/ToDo endpoint the AssignDialog uses.
		await callMethod(request, 'frappe.desk.form.assign_to.add', {
			doctype: 'Wiki Change Request',
			name: crName,
			assign_to: ['Administrator'],
		});

		const [cr] = await getList<{ title: string }>(
			request,
			'Wiki Change Request',
			{ fields: ['title'], filters: { name: crName }, limit: 1 },
		);
		expect(cr?.title).toBeTruthy();

		// Regression: the tab filters on `_assign LIKE %currentUser%`, but the
		// filter referenced a non-existent store property (userStore.user ->
		// undefined), producing `%undefined%` which matched nothing. The CR we
		// just assigned to ourselves must appear in this inbox.
		await page.goto('/wiki/change-requests?tab=assigned');
		await page.waitForLoadState('networkidle');

		await expect(page.getByText(cr.title, { exact: true })).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByText('Nothing assigned to you')).toHaveCount(0);
	});

	test('my-change-requests tab renders draft rows without a router param error', async ({
		page,
	}) => {
		const content = `My-tab draft content ${Date.now()}`;
		// A Draft CR owned by the current user — no submit, so it stays Draft and
		// lands in the "My Change Requests" tab.
		await createSpaceWithDraftPage(page, 'CR My Tab');
		await setEditorContentAndSave(page, content);

		// A Draft row routes to the space editor, which needs the `wiki_space`
		// link id. If only `wiki_space.space_name` is selected, the route resolves
		// with spaceId=undefined and vue-router throws "Missing required param".
		const routerErrors: string[] = [];
		const collect = (text: string) => {
			if (text.includes('Missing required param')) routerErrors.push(text);
		};
		page.on('pageerror', (e) => collect(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') collect(m.text());
		});

		await page.goto('/wiki/change-requests?tab=my');
		await page.waitForLoadState('networkidle');

		// The draft must render as a row linking to its space (not the empty state
		// and not a broken render).
		await expect(page.locator('a[href*="/spaces/"]').first()).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByText('No Change Requests')).toHaveCount(0);

		expect(routerErrors).toEqual([]);
	});

	test('inline preview renders code blocks with syntax highlighting (TipTap viewer)', async ({
		page,
	}) => {
		// A fenced Python block — the inline Preview must render it through the same
		// read-only TipTap viewer the editor uses, which highlights via lowlight.
		const code = '```python\nimport os\nprint(os.getcwd())\n```';
		const { pageTitle } = await createSpaceWithDraftPage(
			page,
			'CR Preview Highlight',
		);
		await setEditorContentAndSave(page, code);
		await submitForReviewFromEditor(page);

		// Expand the changed page row and switch its inline view to Preview.
		await page.getByText(pageTitle, { exact: true }).first().click();
		await page
			.getByRole('button', { name: 'Preview', exact: true })
			.first()
			.click();

		// lowlight wraps tokens in `hljs-*` spans; raw server HTML (the old
		// v-html path) produces none. Their presence proves the TipTap viewer ran.
		await expect(page.locator('pre code')).toContainText('import os');
		await expect(
			page.locator('pre code span[class*="hljs-"]').first(),
		).toBeVisible({ timeout: 10000 });

		// The language picker is an editing affordance — it must not leak into the
		// read-only preview.
		await expect(page.getByText('auto', { exact: true })).toHaveCount(0);
	});

	test('back from review returns to the originating tab', async ({ page }) => {
		const content = `Nav back content ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Nav Back');
		await setEditorContentAndSave(page, content);
		const crName = await submitForReviewFromEditor(page);

		// Enter the CR from a specific tab (not the default 'my').
		await page.goto('/wiki/change-requests?tab=all');
		await page.waitForLoadState('networkidle');
		await page.locator(`a[href*="${crName}"]`).first().click();
		await expect(page).toHaveURL(
			new RegExp(`/wiki/change-requests/${crName}$`),
		);

		// Back from review lands on the originating tab, query preserved.
		await page.getByRole('button', { name: 'Back', exact: true }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\?tab=all/);
	});

	test('author can withdraw an in-review CR back to Draft from the menu', async ({
		page,
	}) => {
		const content = `Withdraw content ${Date.now()}`;
		await createSpaceWithDraftPage(page, 'CR Withdraw');
		await setEditorContentAndSave(page, content);
		await submitForReviewFromEditor(page);

		// The author here can also review, so Withdraw lives in the three-dots menu
		// alongside the reviewer decisions rather than as a standalone button.
		await clickReviewMenuItem(page, 'Withdraw');

		// The CR drops back to Draft, re-opening it for editing.
		await expect(page.getByText('Draft', { exact: true })).toBeVisible({
			timeout: 10000,
		});
	});
});
