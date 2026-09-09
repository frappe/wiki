import { expect, test } from '../fixtures';

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

	test('menu item opens the source file in GitHub editor', async ({
		page,
		wiki,
	}) => {
		// last_sync_time is set so SpaceDetails treats the space as already
		// synced and skips the auto initial-sync (which would hit GitHub).
		// The leaf carries a repo-relative source_path — the GitHub trip's input.
		const leafSourcePath = 'docs/guides/setup.md';
		const leafTitle = `Setup ${Date.now()}`;
		const space = await wiki.space({
			git_synced: 1,
			repo_full_name: REPO,
			branch: BRANCH,
			last_sync_status: 'Success',
			last_sync_time: '2026-01-01 00:00:00',
			pages: [
				{
					title: leafTitle,
					content: '# Setup\n\nFrom the repo.',
					source_path: leafSourcePath,
				},
			],
		});

		await page.goto(space.url());
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

		// A synced page carries the GitHub trip in its header, not behind the
		// page menu — the menu holds only edit actions the page cannot offer.
		const editButton = page.getByRole('button', { name: 'Edit on GitHub' });
		await expect(editButton).toBeVisible();
		await editButton.click();

		const opened = await page.evaluate(
			// @ts-expect-error test-only hook
			() => window.__openedUrl,
		);
		expect(opened).toBe(
			`https://github.com/${REPO}/edit/${BRANCH}/${leafSourcePath}`,
		);
	});
});
