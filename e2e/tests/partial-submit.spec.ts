import { expect, test } from '@playwright/test';
import { callMethod, getList } from '../helpers/frappe';
import { CHANGE_REQUEST_URL_RE, SPACE_URL_RE, appUrl } from '../helpers/routes';
import { openNewPageDialog } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

interface ChangeRequestRow {
	name: string;
	status: string;
}

/**
 * A change request is space-level: everything edited before submitting rides
 * along with it. The submit dialog is where an author splits that
 * apart — send one page for review, keep working on the others.
 */
test.describe('Partial submit', () => {
	test('submits the ticked pages and leaves the rest as a draft', async ({
		page,
		request,
	}) => {
		await page.goto(appUrl('spaces'));
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'New Space' }).click();
		await page.waitForSelector('[role="dialog"]', { state: 'visible' });

		const timestamp = Date.now();
		await page.getByLabel('Space Name').fill(`Partial Submit ${timestamp}`);
		await page.getByLabel('Route').fill(`partial-submit-${timestamp}`);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create' })
			.click();
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveURL(SPACE_URL_RE);

		const spaceUrl = page.url();
		const spaceId = decodeURIComponent(spaceUrl.split('/').pop() as string);
		const pageTitles = [0, 1, 2].map(
			(index) => `partial-page-${index}-${timestamp}`,
		);

		// Three page drafts on one change request.
		for (const title of pageTitles) {
			await page.goto(spaceUrl);
			await page.waitForLoadState('networkidle');
			await openNewPageDialog(page);
			await page.getByLabel('Title').fill(title);
			await page
				.getByRole('dialog')
				.getByRole('button', { name: 'Save' })
				.click();
			await page.waitForTimeout(500);

			await page.locator('aside').getByText(title, { exact: true }).click();
			await page.waitForURL(/\/draft\/[^/?#]+/);
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
			}, `Body of ${title}`);
			await editor.click();
			await page.getByRole('button', { name: 'Save' }).click();
			await page.waitForTimeout(500);
		}

		await page.getByRole('button', { name: 'Submit for Review' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('3 of 3 selected')).toBeVisible();

		// Untick the last two — only the first page goes for review.
		for (const title of pageTitles.slice(1)) {
			await dialog
				.locator('label', { hasText: title })
				.getByRole('checkbox')
				.uncheck();
		}
		await expect(dialog.getByText('1 of 3 selected')).toBeVisible();
		await page.screenshot({ path: 'test-results/partial-submit-dialog.png' });

		await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, { timeout: 10000 });
		await expect(page.getByText('2 changes stayed in your draft')).toBeVisible({
			timeout: 10000,
		});

		// The review page carries one page; the other two are back in a draft.
		await expect(page.getByText('Changes (1)')).toBeVisible({ timeout: 10000 });
		const crs = await getList<ChangeRequestRow>(
			request,
			'Wiki Change Request',
			{
				fields: ['name', 'status'],
				filters: { wiki_space: spaceId },
				limit: 10,
			},
		);
		expect(crs.filter((cr) => cr.status === 'In Review')).toHaveLength(1);

		// The two unticked pages live on a draft the author can keep editing.
		// (Opening the space editor also leaves empty drafts behind, so match on
		// the one that actually carries changes.)
		const draftChangeCounts: number[] = [];
		for (const cr of crs.filter((row) => row.status === 'Draft')) {
			const changes = await callMethod<{ doc_key: string }[]>(
				request,
				`${CR_METHOD}.diff_change_request`,
				{ name: cr.name },
			);
			draftChangeCounts.push(changes.length);
		}
		expect(draftChangeCounts.filter((count) => count > 0)).toEqual([2]);

		// Merging the submitted one publishes only its page.
		await page.getByRole('button', { name: 'Approve', exact: true }).click();
		await expect(page.getByText('Change request approved')).toBeVisible({
			timeout: 15000,
		});
		await page.getByRole('button', { name: 'Merge', exact: true }).click();
		await expect(page.getByText('Change request merged')).toBeVisible({
			timeout: 20000,
		});

		const live = await getList<{ title: string }>(request, 'Wiki Document', {
			fields: ['title'],
			filters: { title: ['like', `partial-page-%-${timestamp}`] },
			limit: 10,
		});
		expect(live.map((doc) => doc.title)).toEqual([pageTitles[0]]);

		// The held-back pages are still editable in the space.
		await page.goto(spaceUrl);
		await page.waitForLoadState('networkidle');
		for (const title of pageTitles.slice(1)) {
			await expect(
				page.locator('aside').getByText(title, { exact: true }),
			).toBeVisible({ timeout: 10000 });
		}
	});
});
