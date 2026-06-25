import { expect, test } from '@playwright/test';
import { createDoc } from '../helpers/frappe';
import {
	type WikiSpace,
	cleanupWikiSpacesByRoute,
	createTestWikiDocument,
} from '../helpers/wiki';

/**
 * TB1b-ii — a git-synced Wiki Space renders read-only in the authoring SPA.
 *
 * We seed a synced space + a published page directly via the API (bypassing the
 * GitHub fetch) and set last_sync_time so SpaceDetails does not auto-kick a real
 * sync. The SPA should then show the "Synced from GitHub" banner, source the
 * sidebar from the live tree, hide every mutation affordance, and open the page
 * in a non-editable viewer.
 */
test.describe('Git-synced space (read-only)', () => {
	const REPO = 'frappe/wiki';
	const BRANCH = 'main';

	let route: string;

	test.afterEach(async ({ request }) => {
		if (route) await cleanupWikiSpacesByRoute(request, route);
		route = '';
	});

	test('renders read-only with no editing affordances', async ({
		page,
		request,
	}) => {
		route = `git-sync-ro-${Date.now()}`;
		// last_sync_time is set so SpaceDetails treats the space as already
		// synced and skips the auto initial-sync (which would hit GitHub).
		const space = await createDoc<WikiSpace & { root_group: string }>(
			request,
			'Wiki Space',
			{
				route,
				space_name: route,
				is_published: true,
				git_synced: 1,
				repo_full_name: REPO,
				branch: BRANCH,
				last_sync_status: 'Success',
				last_sync_time: '2026-01-01 00:00:00',
			},
		);

		const pageTitle = `Synced Page ${Date.now()}`;
		await createTestWikiDocument(request, {
			title: pageTitle,
			content: '# Synced Heading\n\nThis content comes from the repo.',
			wiki_space: space.name,
			parent_wiki_document: space.root_group,
			is_published: true,
		});

		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		// Synced banner: repo link (title) + "Synced from GitHub" subtitle + Sync now.
		await expect(
			page.locator(`a[href="https://github.com/${REPO}"]`),
		).toBeVisible({ timeout: 10000 });
		await expect(page.getByText('Synced from GitHub')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();

		// No create / mutation affordances in the sidebar.
		await expect(page.locator('button[title="New Page"]')).toHaveCount(0);
		await expect(page.locator('button[title="New Group"]')).toHaveCount(0);

		// Open the synced page and confirm the viewer is non-editable.
		await page.locator('aside').getByText(pageTitle, { exact: true }).click();
		await page.waitForURL(/\/page\//);

		const editor = page.locator('.ProseMirror');
		await expect(editor).toBeVisible({ timeout: 10000 });
		await expect(editor).toHaveAttribute('contenteditable', 'false');

		// No Save button and no editor toolbar in read-only mode.
		await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
		await expect(page.locator('.wiki-editor-container button')).toHaveCount(0);
	});
});
