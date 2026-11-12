import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import { callMethod, createDoc, getDoc, getList } from '../helpers/frappe';
import { editPage } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

/**
 * Version history of a page and its space, in the page header panel
 * (specs/edit_flow.md, part 4).
 */

async function mergeEdit(
	request: APIRequestContext,
	space: { name: string },
	page: { doc_key?: string },
	title: string,
	content: string,
) {
	const changeRequest = await callMethod<{ name: string }>(
		request,
		`${CR_METHOD}.create_change_request`,
		{ wiki_space: space.name, title },
	);
	await callMethod(request, `${CR_METHOD}.update_cr_page`, {
		name: changeRequest.name,
		doc_key: page.doc_key,
		fields: { content },
	});
	for (const step of [
		'submit_change_request',
		'approve_change_request',
		'merge_change_request',
	]) {
		await callMethod(request, `${CR_METHOD}.${step}`, {
			name: changeRequest.name,
		});
	}
}

test.describe('Version history', () => {
	test('lists the merges that changed the page and shows their diff', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Install', content: 'Run bench.' },
				{ title: 'FAQ', content: 'Ask us.' },
			],
		});
		const install = space.page('Install');
		await mergeEdit(
			request,
			space,
			install,
			'Explain the bench',
			'Run bench init.',
		);
		await mergeEdit(
			request,
			space,
			space.page('FAQ'),
			'Answer more',
			'Ask away.',
		);
		await mergeEdit(
			request,
			space,
			install,
			'Name the site',
			'Run bench init on site1.',
		);

		await page.goto(space.url('page', install.name));
		await page.getByTestId('page-history-link').click();

		const panel = page.getByTestId('history-panel');
		const versions = panel.getByTestId('history-version');
		await expect(versions.nth(0)).toContainText('Name the site');
		await expect(versions.nth(0)).toContainText('edited');
		await expect(versions.nth(1)).toContainText('Explain the bench');
		await expect(panel).not.toContainText('Answer more');

		await versions.nth(0).click();
		const diff = page.getByTestId('version-diff');
		await expect(diff).toContainText('Name the site');
		await expect(diff.locator('ins')).toHaveText(['on site1']);
		await expect(page.getByTestId('page-reader')).toBeHidden();

		await diff.getByRole('link', { name: 'Open change request' }).click();
		await expect(
			page.getByRole('heading', { name: 'Name the site', level: 1 }),
		).toBeVisible();
		// The side panel is a workspace preference, so it is still open on the way back.
		await page.goBack();
		await panel.getByRole('radio', { name: 'All pages', exact: true }).click();
		await expect(versions.nth(0)).toContainText('1 page');
		await expect(versions.nth(1)).toContainText('Answer more');
		await versions.nth(1).click();
		await expect(diff.getByTestId('page-diff')).toContainText('FAQ');
		await expect(diff.locator('ins')).toHaveText(['away']);

		await diff.getByRole('button', { name: 'Back to current version' }).click();
		await expect(diff).toHaveCount(0);
		await expect(page.getByTestId('page-reader')).toContainText(
			'Run bench init on site1.',
		);
	});

	test('keeps unsaved edits behind a version diff', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Install', content: 'Run bench.' }],
		});
		const install = space.page('Install');
		await mergeEdit(
			request,
			space,
			install,
			'Explain the bench',
			'Run bench init.',
		);

		await page.goto(space.url('page', install.name));
		await editPage(page, 'Tidy install');
		await page.keyboard.type(' Then restart.');
		// Submit joins the header once there is a change, and shifts the buttons left.
		await expect(
			page.getByRole('button', { name: 'Submit for review' }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Version history' }).click();
		await page.getByTestId('history-version').first().click();
		await expect(page.getByTestId('version-diff').locator('ins')).toHaveText([
			'init',
		]);
		await page
			.getByTestId('version-diff')
			.getByRole('button', { name: 'Back to current version' })
			.click();

		await expect(
			page.locator('.ProseMirror[contenteditable="true"]'),
		).toContainText('Run bench init. Then restart.');
	});

	test('shows a git sync with its commit', async ({ page, request, wiki }) => {
		const space = await wiki.space({
			git_synced: 1,
			repo_full_name: 'frappe/wiki',
			branch: 'main',
			last_sync_status: 'Success',
			last_sync_time: '2026-01-01 00:00:00',
			pages: [{ title: 'Synced Page', content: 'From the repo.' }],
		});
		const { main_revision } = await getDoc<{ main_revision: string }>(
			request,
			'Wiki Space',
			space.name,
		);
		// What a sync writes: a merge revision with no change request.
		const sync = await createDoc<{ name: string }>(request, 'Wiki Revision', {
			wiki_space: space.name,
			message: 'git-sync: repo snapshot',
			source_commit: 'abc1234def5678',
			is_merge: 1,
			created_by: 'Administrator',
			created_at: '2099-01-01 00:00:00',
		});
		const items = await getList<Record<string, unknown>>(
			request,
			'Wiki Revision Item',
			{
				fields: [
					'doc_key',
					'title',
					'slug',
					'route',
					'is_group',
					'is_published',
					'parent_key',
					'order_index',
					'content_blob',
				],
				filters: { revision: main_revision },
				limit: 0,
			},
		);
		for (const item of items) {
			await createDoc(request, 'Wiki Revision Item', {
				...item,
				revision: sync.name,
				title: item.title === 'Synced Page' ? 'Synced Guide' : item.title,
			});
		}

		await page.goto(space.url('page', space.page('Synced Page').name));
		await page.getByRole('button', { name: 'Version history' }).click();

		const latest = page.getByTestId('history-version').first();
		await expect(latest).toContainText('synced from abc1234');
		await expect(latest).toContainText('renamed from Synced Page');
		await latest.click();
		await expect(
			page
				.getByTestId('version-diff')
				.getByRole('link', { name: 'View commit' }),
		).toHaveAttribute(
			'href',
			'https://github.com/frappe/wiki/commit/abc1234def5678',
		);
	});
});
