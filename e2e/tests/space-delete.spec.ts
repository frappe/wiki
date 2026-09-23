import { expect, test } from '../fixtures';
import { docExists } from '../helpers/frappe';

/**
 * Space Settings -> General -> Delete Space.
 *
 * Deleting a space takes every page with it, so the dialog says how many
 * and the button stays disabled until the space name is typed back exactly.
 */
test.describe('Space Settings -> Delete Space', () => {
	test('deletes the space and its pages once the name is typed', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{
					title: 'Guide',
					is_group: true,
					children: [{ title: 'Install' }, { title: 'Upgrade' }],
				},
			],
		});

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();
		await page.getByRole('button', { name: 'Delete', exact: true }).click();

		const confirm = page.getByRole('dialog', {
			name: `Delete Space ${space.space_name}`,
		});
		const deleteButton = confirm.getByRole('button', { name: 'Delete Space' });
		await expect(deleteButton).toBeDisabled();
		// The group is navigation, not a page, so only its two children count.
		await expect(confirm).toContainText('2 pages');

		await confirm.getByRole('textbox').fill(`${space.space_name}x`);
		await expect(deleteButton).toBeDisabled();

		// The name in the label copies itself, so it can be pasted into the box.
		await page
			.context()
			.grantPermissions(['clipboard-read', 'clipboard-write']);
		await confirm.getByRole('button', { name: space.space_name }).click();
		await confirm.getByRole('textbox').fill('');
		await page.keyboard.press('ControlOrMeta+V');
		await expect(confirm.getByRole('textbox')).toHaveValue(space.space_name);
		await deleteButton.click();

		await expect(page).toHaveURL(/\/wiki-app\/?$/);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByText(space.space_name, { exact: true })).toHaveCount(
			0,
		);

		expect(await docExists(request, 'Wiki Space', space.name)).toBe(false);
		for (const name of [
			space.rootGroup,
			space.page('Guide').name,
			space.page('Install').name,
		]) {
			expect(await docExists(request, 'Wiki Document', name)).toBe(false);
		}
	});
});
