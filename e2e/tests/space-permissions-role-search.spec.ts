import { expect, test } from '@playwright/test';
import { createDoc, deleteDoc, getDoc, getList } from '../helpers/frappe';
import { appUrl } from '../helpers/routes';
import { createTestWikiSpace, deleteTestWikiSpace } from '../helpers/wiki';

/**
 * Space Settings -> Permissions role picker searches on the server.
 *
 * Regression for #709: the picker used to load a single page of roles and
 * filter it in the browser, so on any site with more roles than fit in that
 * page the rest were unreachable. The seeded role below is named to sort last
 * alphabetically, so it can only be found if the typed query actually reaches
 * the server.
 */
test.describe('Space Settings -> Permissions role search', () => {
	let roleName = '';
	let spaceName = '';

	test.afterEach(async ({ request }) => {
		// The space's child row links the role, so the space goes first.
		if (spaceName) await deleteTestWikiSpace(request, spaceName);
		if (roleName) await deleteDoc(request, 'Role', roleName);
		spaceName = '';
		roleName = '';
	});

	test('finds and adds a role that sorts past the first page', async ({
		page,
		request,
	}) => {
		// The bug only bites once there are more roles than one page holds.
		const enabledRoles = await getList(request, 'Role', {
			filters: { disabled: 0 },
			limit: 0,
		});
		expect(
			enabledRoles.length,
			'site needs more than one page of roles for this regression to bite',
		).toBeGreaterThan(20);

		roleName = `ZZZ Wiki Role ${Date.now()}`;
		await createDoc(request, 'Role', { role_name: roleName });

		const space = await createTestWikiSpace(request, {
			route: `role-search-${Date.now()}`,
		});
		spaceName = space.name;

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(appUrl('spaces', space.name));
		await page.waitForLoadState('networkidle');

		await page.getByTitle('Settings').first().click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('tab', { name: 'Permissions', exact: true }).click();

		// Type a fragment that no role from the first page matches.
		const picker = dialog.getByPlaceholder('Search role to add');
		await expect(picker).toBeVisible();
		await picker.fill(roleName.slice(0, 12));

		// The popover is portaled out of the dialog, so it lives on the page.
		const option = page.getByRole('option', { name: roleName, exact: true });
		await expect(option).toBeVisible({ timeout: 10000 });
		await option.click();

		// Picking fills the field; Add commits the row, at Read by default.
		await dialog.getByRole('button', { name: 'Add', exact: true }).click();
		const row = dialog.getByRole('row').filter({ hasText: roleName });
		await expect(row).toBeVisible();

		await dialog.getByRole('button', { name: 'Save', exact: true }).click();

		await expect
			.poll(
				async () => {
					const doc = await getDoc<{
						roles?: { role: string; permission_level: string }[];
					}>(request, 'Wiki Space', space.name);
					return (doc.roles || []).find((r) => r.role === roleName)
						?.permission_level;
				},
				{ timeout: 10000 },
			)
			.toBe('Read');
	});
});
