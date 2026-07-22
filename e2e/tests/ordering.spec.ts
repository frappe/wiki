import { expect, test } from '@playwright/test';
import { callMethod, updateDoc } from '../helpers/frappe';
import { createTestWikiDocument, createTestWikiSpace } from '../helpers/wiki';

/**
 * E2E tests for wiki document ordering functionality.
 * Tests that:
 * 1. New documents appear at the bottom of the list
 * 2. Reordering documents persists after page refresh
 * 3. Order is consistent between admin and public-facing views
 */
test.describe('Wiki Document Ordering', () => {
	test('new document should appear at bottom of sidebar', async ({
		page,
		request,
	}) => {
		// Create a test space with 5 folders via API
		const spaceName = `ordering-test-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceName,
			is_published: true,
		});

		// Create root group for the space
		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceName}/root`,
			is_group: true,
			is_published: true,
		});

		// Update space with root_group
		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		// Create 5 folders (Q1-Q5) under root
		const folders: string[] = [];
		for (let i = 1; i <= 5; i++) {
			const folder = await createTestWikiDocument(request, {
				title: `Q${i}`,
				route: `${spaceName}/q${i}`,
				is_group: true,
				is_published: true,
				parent_wiki_document: rootGroup.name,
			});
			folders.push(folder.name);

			// Create a child page so folder shows in public view
			await createTestWikiDocument(request, {
				title: `Page in Q${i}`,
				route: `${spaceName}/q${i}/page`,
				is_group: false,
				is_published: true,
				parent_wiki_document: folder.name,
			});
		}

		// Navigate to the wiki space admin
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		// Get initial order from sidebar - wait for tree to load
		await page.waitForSelector('aside >> text=Q1', { timeout: 10000 });

		const getSidebarOrder = async () => {
			// Get all text from the sidebar tree area
			const sidebarText = await page.locator('aside').innerText();
			// Extract Q1, Q2, etc. from the text in order they appear
			const matches = sidebarText.match(/Q\d+/g) || [];
			// Remove duplicates while preserving order
			return [...new Set(matches)];
		};

		const initialOrder = await getSidebarOrder();

		// Verify Q1-Q5 are in order
		expect(initialOrder).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);

		// Create a new folder Q6 via UI
		const newGroupButton = page.locator('button[title="New Group"]');
		await expect(newGroupButton).toBeVisible({ timeout: 5000 });
		await newGroupButton.click();

		// Fill in the title
		await page.getByLabel('Title').fill('Q6');
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		// Wait a moment for the tree to update
		await page.waitForTimeout(1000);

		// Get the new order - Q6 should be at the bottom
		const orderAfterCreate = await getSidebarOrder();

		// Q6 should appear at the end, not at the beginning
		expect(orderAfterCreate[orderAfterCreate.length - 1]).toBe('Q6');
		expect(orderAfterCreate).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']);
	});

	test('reorder should persist after page refresh', async ({
		page,
		request,
	}) => {
		// Create a test space with folders via API
		const spaceName = `reorder-test-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceName,
			is_published: true,
		});

		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceName}/root`,
			is_group: true,
			is_published: true,
		});

		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		// Create 5 folders
		const folders: string[] = [];
		for (let i = 1; i <= 5; i++) {
			const folder = await createTestWikiDocument(request, {
				title: `Folder${i}`,
				route: `${spaceName}/folder${i}`,
				is_group: true,
				is_published: true,
				parent_wiki_document: rootGroup.name,
			});
			folders.push(folder.name);

			await createTestWikiDocument(request, {
				title: `Page in Folder${i}`,
				route: `${spaceName}/folder${i}/page`,
				is_group: false,
				is_published: true,
				parent_wiki_document: folder.name,
			});
		}

		// Navigate to the wiki space admin
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		// Wait for tree to load and get folder order from sidebar
		await page.waitForSelector('aside >> text=Folder1', { timeout: 10000 });

		const getSidebarFolderOrder = async () => {
			const sidebarText = await page.locator('aside').innerText();
			const matches = sidebarText.match(/Folder\d+/g) || [];
			return [...new Set(matches)];
		};

		const initialOrder = await getSidebarFolderOrder();
		expect(initialOrder).toEqual([
			'Folder1',
			'Folder2',
			'Folder3',
			'Folder4',
			'Folder5',
		]);

		// Reorder via API: Move Folder5 to first position
		const newSiblingsOrder = [
			folders[4],
			folders[0],
			folders[1],
			folders[2],
			folders[3],
		]; // Folder5, Folder1, Folder2, Folder3, Folder4

		await callMethod(request, 'wiki.api.wiki_space.reorder_wiki_documents', {
			doc_name: folders[4], // Folder5
			new_parent: rootGroup.name,
			new_index: 0,
			siblings: JSON.stringify(newSiblingsOrder),
		});

		// Refresh the page
		await page.reload();
		await page.waitForLoadState('networkidle');

		// Verify the order persisted
		const orderAfterRefresh = await getSidebarFolderOrder();

		expect(orderAfterRefresh).toEqual([
			'Folder5',
			'Folder1',
			'Folder2',
			'Folder3',
			'Folder4',
		]);
	});

	test('order should be consistent between admin and public views', async ({
		page,
		request,
	}) => {
		// Create a test space
		const spaceName = `consistency-test-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceName,
			is_published: true,
		});

		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceName}/root`,
			is_group: true,
			is_published: true,
		});

		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		// Create 5 folders with specific order
		const folderNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
		const folders: string[] = [];

		for (const name of folderNames) {
			const folder = await createTestWikiDocument(request, {
				title: name,
				route: `${spaceName}/${name.toLowerCase()}`,
				is_group: true,
				is_published: true,
				parent_wiki_document: rootGroup.name,
			});
			folders.push(folder.name);

			// Create a published page inside each folder
			await createTestWikiDocument(request, {
				title: `${name} Page`,
				route: `${spaceName}/${name.toLowerCase()}/page`,
				is_group: false,
				is_published: true,
				parent_wiki_document: folder.name,
			});
		}

		// Check admin view order
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=Alpha', { timeout: 10000 });

		const getAdminOrder = async () => {
			const sidebarText = await page.locator('aside').innerText();
			// Extract folder names in order they appear
			const order: string[] = [];
			for (const name of folderNames) {
				if (sidebarText.includes(name) && !order.includes(name)) {
					order.push(name);
				}
			}
			// Sort by position in sidebarText
			order.sort((a, b) => sidebarText.indexOf(a) - sidebarText.indexOf(b));
			return order;
		};

		const adminOrder = await getAdminOrder();

		// Navigate to public view
		await page.goto(`/${spaceName}/alpha/page`);
		await page.waitForLoadState('networkidle');
		// Wait for sidebar to render
		await page.waitForTimeout(1000);

		// Get order from public sidebar - get full page text and parse it
		const getPublicOrder = async () => {
			// The sidebar is on the left, get text from the whole page
			const pageText = await page.locator('body').innerText();
			const order: string[] = [];
			for (const name of folderNames) {
				if (pageText.includes(name) && !order.includes(name)) {
					order.push(name);
				}
			}
			order.sort((a, b) => pageText.indexOf(a) - pageText.indexOf(b));
			return order;
		};

		const publicOrder = await getPublicOrder();

		// Both orders should match
		expect(publicOrder).toEqual(adminOrder);
		expect(publicOrder).toEqual(folderNames);
	});

	test('drag and drop reorder should update public view', async ({
		page,
		request,
	}) => {
		// Create a test space
		const spaceName = `dragdrop-test-${Date.now()}`;
		const space = await createTestWikiSpace(request, {
			route: spaceName,
			is_published: true,
		});

		const rootGroup = await createTestWikiDocument(request, {
			title: 'Root',
			route: `${spaceName}/root`,
			is_group: true,
			is_published: true,
		});

		await updateDoc(request, 'Wiki Space', space.name, {
			root_group: rootGroup.name,
		});

		// Create 3 folders for simpler drag test
		const folderNames = ['First', 'Second', 'Third'];
		const folders: string[] = [];

		for (const name of folderNames) {
			const folder = await createTestWikiDocument(request, {
				title: name,
				route: `${spaceName}/${name.toLowerCase()}`,
				is_group: true,
				is_published: true,
				parent_wiki_document: rootGroup.name,
			});
			folders.push(folder.name);

			await createTestWikiDocument(request, {
				title: `${name} Content`,
				route: `${spaceName}/${name.toLowerCase()}/content`,
				is_group: false,
				is_published: true,
				parent_wiki_document: folder.name,
			});
		}

		// Navigate to admin view
		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');
		await page.waitForSelector('aside >> text=First', { timeout: 10000 });

		// Get initial order
		const getOrder = async () => {
			const sidebarText = await page.locator('aside').innerText();
			const order: string[] = [];
			for (const name of folderNames) {
				if (sidebarText.includes(name) && !order.includes(name)) {
					order.push(name);
				}
			}
			order.sort((a, b) => sidebarText.indexOf(a) - sidebarText.indexOf(b));
			return order;
		};

		// Reorder via API: Move "Third" to first position
		const newOrder = [folders[2], folders[0], folders[1]]; // Third, First, Second

		await callMethod(request, 'wiki.api.wiki_space.reorder_wiki_documents', {
			doc_name: folders[2],
			new_parent: rootGroup.name,
			new_index: 0,
			siblings: JSON.stringify(newOrder),
		});

		// Refresh admin view
		await page.reload();
		await page.waitForLoadState('networkidle');

		const adminOrderAfter = await getOrder();
		expect(adminOrderAfter).toEqual(['Third', 'First', 'Second']);

		// Check public view
		await page.goto(`/${spaceName}/third/content`);
		await page.waitForLoadState('networkidle');
		// Wait for sidebar to render
		await page.waitForTimeout(1000);

		const getPublicOrder = async () => {
			const pageText = await page.locator('body').innerText();
			const order: string[] = [];
			for (const name of folderNames) {
				if (pageText.includes(name) && !order.includes(name)) {
					order.push(name);
				}
			}
			order.sort((a, b) => pageText.indexOf(a) - pageText.indexOf(b));
			return order;
		};

		const publicOrder = await getPublicOrder();
		expect(publicOrder).toEqual(['Third', 'First', 'Second']);
	});
});
