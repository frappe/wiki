import { expect, test } from '../fixtures';
import { callMethod } from '../helpers/frappe';

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

		await page.goto(`/wiki-app/change-requests/${changeRequest.name}`);

		await expect(
			page.getByRole('heading', { name: 'Document the v16 upgrade' }),
		).toBeVisible();
		await expect(page.getByText('Adds an upgrade section.')).toBeVisible();
		await expect(page.getByText('· 2 pages')).toBeVisible();

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
});

function viewButton(page: import('@playwright/test').Page, name: string) {
	return page
		.getByRole('radio', { name })
		.or(page.getByRole('button', { name }))
		.first();
}
