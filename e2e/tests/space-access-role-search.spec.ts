import { expect, test } from '../fixtures';
import { createDoc, deleteDoc, getDoc, getList } from '../helpers/frappe';

/**
 * Space Settings -> Access role picker searches on the server.
 *
 * Regression for #709: the picker used to load a single page of roles and
 * filter it in the browser, so on any site with more roles than fit in that
 * page the rest were unreachable. The seeded role below is named to sort last
 * alphabetically, so it can only be found if the typed query actually reaches
 * the server.
 */
test.describe('Space Settings -> Access role search', () => {
	let roleName = '';

	test.afterEach(async ({ request, wiki }) => {
		// The space's child row links the role, so the space goes first — the
		// fixture's own teardown runs after this hook, which would be too late.
		await wiki.destroyAll();
		if (roleName) await deleteDoc(request, 'Role', roleName);
		roleName = '';
	});

	test('finds and adds a role that sorts past the first page', async ({
		page,
		request,
		wiki,
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

		const space = await wiki.space();

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		// The sidebar's Settings button became a "Space actions" menu (spec 01).
		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('tab', { name: 'Access', exact: true }).click();

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
