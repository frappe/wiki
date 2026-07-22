import { expect, test } from '@playwright/test';
import { createDoc } from '../helpers/frappe';
import {
	type WikiDocument,
	type WikiSpace,
	cleanupWikiSpacesByRoute,
} from '../helpers/wiki';

/**
 * TB2 — "Edit on GitHub" on a synced page.
 *
 * A git-synced page carries a repo-relative source_path. Its three-dots menu
 * should offer "Edit on GitHub", opening the source file in GitHub's web editor
 * at https://github.com/{repo}/edit/{branch}/{source_path}. We seed the space +
 * pages via the API (last_sync_time set so no real GitHub fetch fires) and stub
 * window.open to assert the exact URL without leaving the app.
 */
test.describe('Git-synced space — Edit on GitHub (TB2)', () => {
	const REPO = 'frappe/wiki';
	const BRANCH = 'main';

	let route: string;

	test.afterEach(async ({ request }) => {
		if (route) await cleanupWikiSpacesByRoute(request, route);
		route = '';
	});

	test('menu item opens the source file in GitHub editor', async ({
		page,
		request,
	}) => {
		route = `git-sync-edit-${Date.now()}`;
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

		// A nested leaf page with a repo-relative source_path.
		const leafSourcePath = 'docs/guides/setup.md';
		const leafTitle = `Setup ${Date.now()}`;
		await createDoc<WikiDocument>(request, 'Wiki Document', {
			title: leafTitle,
			route: `${route}/setup`,
			content: '# Setup\n\nFrom the repo.',
			wiki_space: space.name,
			parent_wiki_document: space.root_group,
			is_published: true,
			source_path: leafSourcePath,
		});

		await page.goto(`/wiki/spaces/${space.name}`);
		await page.waitForLoadState('networkidle');

		// Open the synced page.
		await page.locator('aside').getByText(leafTitle, { exact: true }).click();
		await page.waitForURL(/\/page\//);
		await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 });

		// Stub window.open so we can read the URL without navigating away.
		await page.evaluate(() => {
			// @ts-expect-error test-only hook
			window.__openedUrl = null;
			window.open = (url) => {
				// @ts-expect-error test-only hook
				window.__openedUrl = url;
				return null;
			};
		});

		await page.getByRole('button', { name: 'More actions' }).click();
		const editItem = page.getByRole('menuitem', { name: 'Edit on GitHub' });
		await expect(editItem).toBeVisible();
		await editItem.click();

		const opened = await page.evaluate(
			// @ts-expect-error test-only hook
			() => window.__openedUrl,
		);
		expect(opened).toBe(
			`https://github.com/${REPO}/edit/${BRANCH}/${leafSourcePath}`,
		);
	});
});
