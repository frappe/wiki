import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';
import { callMethod, getList } from '../helpers/frappe';
import { editPage, publishChangeRequestFromReview } from '../helpers/wiki';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

/**
 * The review page shows every changed page rendered, with the changed
 * blocks and words marked (specs/change_request_review.md).
 */

const INSTALL = `Install Frappe Wiki on an existing bench.

## Steps

Requires Frappe v15 or v16.`;

test.describe('Change request review', () => {
	test('shows each changed page as a rendered diff', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Installation', content: INSTALL },
				{ title: 'Configuration', content: 'Open Wiki Settings.' },
			],
		});
		const changeRequest = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD}.create_change_request`,
			{
				wiki_space: space.name,
				title: 'Document the v16 upgrade',
				description: 'Adds an upgrade section.',
			},
		);
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: changeRequest.name,
			doc_key: space.page('Installation').doc_key,
			fields: {
				content: `${INSTALL.replace(
					'v15 or v16',
					'v15 or later',
				)}\n\n## Upgrade from v15\n\nBack up the site first.`,
			},
		});
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: changeRequest.name,
			doc_key: space.page('Configuration').doc_key,
			fields: { title: 'Settings' },
		});

		// An old link lands on the review inside its space, next to the page tree.
		await page.goto(`/wiki-app/change-requests/${changeRequest.name}`);
		await expect(page).toHaveURL(
			new RegExp(
				`/spaces/${space.name}/change-requests/${changeRequest.name}$`,
			),
		);
		await expect(page.locator('aside').getByText('Installation')).toBeVisible();

		await expect(
			page.getByRole('heading', { name: 'Document the v16 upgrade' }),
		).toBeVisible();
		await expect(page.getByText('Adds an upgrade section.')).toBeVisible();
		await expect(page.getByRole('main').getByText('· 2 pages')).toBeVisible();

		const installation = page
			.getByTestId('page-diff')
			.filter({ hasText: 'Installation' });
		await expect(installation).toContainText('2 added, 1 edited');
		await expect(installation.locator('del')).toHaveText(['v16']);
		await expect(installation.locator('ins')).toHaveText(['later']);
		await expect(
			installation.getByRole('heading', { name: 'Upgrade from v15' }),
		).toBeVisible();
		await expect(
			installation.getByText('Before', { exact: true }),
		).toBeVisible();

		const settings = page
			.getByTestId('page-diff')
			.filter({ hasText: 'Settings' });
		await expect(settings.locator('header .line-through')).toHaveText(
			'Configuration',
		);
		await expect(settings).toContainText('No content changes');

		await viewButton(page, 'Inline').click();
		await expect(installation.getByText('Before', { exact: true })).toHaveCount(
			0,
		);
		await expect(installation.locator('del')).toHaveText(['v16']);
		await expect(installation.locator('ins')).toHaveText(['later']);

		await page.getByText('Show changes only').click();
		await expect(installation).toContainText('2 unchanged blocks');
		await expect(
			installation.getByText('Install Frappe Wiki on an existing bench.'),
		).toHaveCount(0);

		await viewButton(page, 'Markdown').click();
		await expect(installation).toContainText('## Upgrade from v15');
	});

	test('merging on the review updates the space sidebar', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Configuration' }] });
		const changeRequest = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD}.create_change_request`,
			{ wiki_space: space.name, title: 'Rename configuration' },
		);
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: changeRequest.name,
			doc_key: space.page('Configuration').doc_key,
			fields: { title: 'Settings' },
		});
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: changeRequest.name,
		});

		await page.goto(`/wiki-app/change-requests/${changeRequest.name}`);
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('Configuration')).toBeVisible();

		await publishChangeRequestFromReview(page);
		await expect(sidebar.getByText('Settings')).toBeVisible();
		await expect(sidebar.getByText('Configuration')).toHaveCount(0);
	});

	test('View changes in the strip opens the review, unsaved edits included', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
		await page.goto(space.url('page', space.page('Alpha').name));
		await editPage(page, 'Quick fix');
		await page.keyboard.type(' Fixed.');
		await expect(page.getByText('Draft · 1 page changed')).toBeVisible({
			timeout: 15000,
		});

		await page.keyboard.type(' Again.');
		await page
			.locator('aside')
			.getByRole('button', { name: 'More actions' })
			.click();
		await page.getByRole('menuitem', { name: /View changes/ }).click();

		await expect(page).toHaveURL(/\/change-requests\//);
		const diff = page.getByTestId('page-diff').filter({ hasText: 'Alpha' });
		await expect(diff.locator('ins').last()).toContainText('Again');
	});

	test('reviewing the first pages of an empty space offers no New page', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space();
		const changeRequest = await wiki.changeRequest(space, 'First pages');
		const tree = await callMethod<{ root_group: string }>(
			request,
			`${CR_METHOD}.get_cr_tree`,
			{ name: changeRequest.name },
		);
		await callMethod(request, `${CR_METHOD}.create_cr_page`, {
			name: changeRequest.name,
			parent_key: tree.root_group,
			title: 'Welcome',
		});
		await callMethod(request, `${CR_METHOD}.submit_change_request`, {
			name: changeRequest.name,
		});

		await page.goto(space.url('change-requests', changeRequest.name));
		const sidebar = page.locator('aside');
		await expect(sidebar.getByText('No pages are published yet')).toBeVisible({
			timeout: 15000,
		});
		await expect(sidebar.getByText('Create your first page')).toHaveCount(0);
		await expect(sidebar.getByRole('button', { name: 'New page' })).toHaveCount(
			0,
		);
	});

	test('merge conflicts start with no choice made', async ({
		page,
		request,
		wiki,
	}) => {
		const { shared, second } = await conflictingChangeRequests(request, wiki);

		await page.goto(`/wiki-app/change-requests/${second}`);
		await page.getByRole('button', { name: 'Merge', exact: true }).click();
		const resolveAndMerge = page.getByRole('button', {
			name: 'Resolve & Merge',
		});
		await expect(page.getByText('0/1 resolved')).toBeVisible();
		await expect(resolveAndMerge).toBeDisabled();

		const card = page.getByRole('button', { name: /Shared/ });
		await card.focus();
		await page.keyboard.press('Enter');
		await expect(card).toHaveAttribute('aria-expanded', 'true');
		const keepMain = page.getByRole('radio', { name: 'Keep main' });
		await expect(keepMain).not.toBeChecked();
		await expect(
			page.getByRole('radio', { name: 'Keep this change request' }),
		).not.toBeChecked();
		await keepMain.click();
		await expect(keepMain).toBeChecked();
		await expect(page.getByText('1/1 resolved')).toBeVisible();
		await expect(page.getByText('Ready to merge')).toBeVisible();
		await resolveAndMerge.click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });
		const [merged] = await getList<{ content: string }>(
			request,
			'Wiki Document',
			{ fields: ['content'], filters: { name: shared.name } },
		);
		expect(merged.content).toBe('From the first.');
	});
	test('a reload keeps open merge conflicts', async ({
		page,
		request,
		wiki,
	}) => {
		const { second } = await conflictingChangeRequests(request, wiki);
		await page.goto(`/wiki-app/change-requests/${second}`);
		await page.getByRole('button', { name: 'Merge', exact: true }).click();
		await expect(page.getByText('0/1 resolved')).toBeVisible();

		await page.reload();
		await expect(page.getByText('0/1 resolved')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Resolve & Merge' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Merge', exact: true }),
		).toHaveCount(0);
	});
});

function viewButton(page: import('@playwright/test').Page, name: string) {
	return page
		.getByRole('radio', { name })
		.or(page.getByRole('button', { name }))
		.first();
}

/** Two approved change requests edit one paragraph, and the first is merged. */
async function conflictingChangeRequests(
	request: APIRequestContext,
	wiki: WikiFactory,
) {
	const space = await wiki.space({
		pages: [{ title: 'Shared', content: 'Start.' }],
	});
	const shared = space.page('Shared');
	const editShared = async (title: string, content: string) => {
		const changeRequest = await callMethod<{ name: string }>(
			request,
			`${CR_METHOD}.create_change_request`,
			{ wiki_space: space.name, title },
		);
		await callMethod(request, `${CR_METHOD}.update_cr_page`, {
			name: changeRequest.name,
			doc_key: shared.doc_key,
			fields: { content },
		});
		for (const step of ['submit', 'approve']) {
			await callMethod(request, `${CR_METHOD}.${step}_change_request`, {
				name: changeRequest.name,
			});
		}
		return changeRequest.name;
	};
	const first = await editShared('First edit', 'From the first.');
	const second = await editShared('Second edit', 'From the second.');
	await callMethod(request, `${CR_METHOD}.merge_change_request`, {
		name: first,
	});
	return { shared, second };
}
