import { expect, test } from '@playwright/test';
import { callMethod, getList } from '../helpers/frappe';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
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
			.getByRole('button', { name: 'Save Draft' })
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
		await page.getByRole('button', { name: 'Save Draft' }).click();
		await page.waitForTimeout(500);

		// Submit for review and merge
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});

		await page.getByRole('button', { name: 'Merge' }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

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
		await page.getByRole('button', { name: 'Save Draft' }).click();
		await page.waitForTimeout(500);

		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(/\/wiki\/change-requests\//, {
			timeout: 10000,
		});

		await page.getByRole('button', { name: 'Merge' }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

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
				.getByRole('button', { name: 'Save Draft' })
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
				.getByRole('button', { name: 'Save Draft' })
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
				'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_or_create_draft_change_request',
				{ wiki_space: spaceId },
			);
			await callMethod(
				request,
				'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.request_review',
				{ name: draftChangeRequest.name, reviewers: [] },
			);
			return `/wiki/change-requests/${draftChangeRequest.name}`;
		};

		const mergeChangeRequest = async (url: string) => {
			await page.goto(url);
			await page.getByRole('button', { name: 'Merge' }).click();
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

		await callMethod(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.request_review',
			{ name: initialDraft.name, reviewers: [] },
		);
		await callMethod(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.merge_change_request',
			{ name: initialDraft.name },
		);

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
		await callMethod(
			request,
			'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.request_review',
			{ name: draftChangeRequest.name, reviewers: [] },
		);
		await page.goto(`/wiki/change-requests/${draftChangeRequest.name}`);
		await page.waitForLoadState('networkidle');

		const changeCard = page
			.locator('div.border.border-outline-gray-2.rounded-lg.overflow-hidden')
			.filter({ has: page.getByText(movedTitle, { exact: true }) })
			.first();
		await expect(
			changeCard.getByText('Reordered', { exact: true }),
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
			.getByRole('button', { name: 'Save Draft' })
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
		await page.getByRole('button', { name: 'Save Draft' }).click();
		await page.waitForTimeout(500);

		// Merge directly from within the space editor (manager can merge Draft CRs)
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
});
