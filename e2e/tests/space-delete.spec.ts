import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createDoc, docExists } from '../helpers/frappe';

async function openGeneralSettings(page: Page) {
	await page.getByRole('button', { name: 'Space actions' }).click();
	await page.getByRole('menuitem', { name: 'Space settings' }).click();
	await expect(page.getByText('Clone Space')).toBeVisible();
}

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

		await openGeneralSettings(page);
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

	// Deleting needs the role's delete permission as well as write access to
	// the space, so a Wiki User holding Write on the space still cannot.
	for (const level of ['Read', 'Write']) {
		test(`a Wiki User with ${level} access is not offered Delete`, async ({
			browser,
			request,
			wiki,
		}, info) => {
			const stamp = Date.now().toString(36);
			const email = `e2e-delete-${level.toLowerCase()}-${stamp}@example.com`;
			const password = `Delete-${stamp}!`;
			await createDoc(request, 'User', {
				email,
				first_name: 'E2E Delete',
				new_password: password,
				send_welcome_email: 0,
				roles: [{ role: 'Wiki User' }],
			});
			const space = await wiki.space({
				roles: [{ role: 'Wiki User', permission_level: level }],
			});

			const context = await browser.newContext({
				baseURL: info.project.use.baseURL,
			});
			await context.request.post('/api/method/login', {
				form: { usr: email, pwd: password },
			});
			const page = await context.newPage();
			await page.goto(space.url());
			await page.waitForLoadState('networkidle');

			await openGeneralSettings(page);
			await expect(page.getByText('Delete Space')).toHaveCount(0);

			await context.close();
		});
	}
});
