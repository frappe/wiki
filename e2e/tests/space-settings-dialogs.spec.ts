import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { getDoc, updateDoc } from '../helpers/frappe';

async function openGeneralSettings(page: Page) {
	await page.getByRole('button', { name: 'Space actions' }).click();
	await page.getByRole('menuitem', { name: 'Space settings' }).click();
	return page.getByRole('dialog', { name: 'Settings' });
}

/**
 * Space Settings -> General opens its own dialogs on top of the settings one.
 * Each must reach assistive technology, take focus, and hand it back on Escape.
 */
test.describe('Space Settings -> General dialogs', () => {
	const dialogs = [
		{
			opener: 'Update',
			title: () => 'Update Wiki Space Routes',
			action: 'Update Routes',
			textboxes: 2,
		},
		{
			opener: 'Clone',
			title: () => 'Clone Wiki Space',
			action: 'Start Cloning',
			textboxes: 1,
		},
		{
			opener: 'Delete',
			title: (spaceName: string) => `Delete Space ${spaceName}`,
			action: 'Delete Space',
			textboxes: 1,
		},
	];

	for (const { opener, title, action, textboxes } of dialogs) {
		test(`${opener} dialog is exposed, takes focus and closes on Escape`, async ({
			page,
			wiki,
		}) => {
			const space = await wiki.space({ pages: [{ title: 'Guide' }] });
			await page.goto(space.url());
			await page.waitForLoadState('networkidle');

			const settings = await openGeneralSettings(page);
			const openButton = settings.getByRole('button', {
				name: opener,
				exact: true,
			});
			await openButton.click();

			const dialog = page.getByRole('dialog', {
				name: title(space.space_name),
			});
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole('textbox')).toHaveCount(textboxes);
			await expect(dialog.getByRole('button', { name: action })).toBeVisible();
			await expect(
				dialog.getByRole('button', { name: 'Cancel' }),
			).toBeVisible();
			await expect(dialog.locator(':focus')).toHaveCount(1);

			await page.keyboard.press('Escape');

			await expect(dialog).toHaveCount(0);
			await expect(settings).toBeVisible();
			await expect(openButton).toBeFocused();
		});
	}

	test('Update Routes moves the space to the new route', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({ pages: [{ title: 'Guide' }] });
		const newRoute = `${space.route}-moved`;
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		const settings = await openGeneralSettings(page);
		await settings.getByRole('button', { name: 'Update', exact: true }).click();

		const dialog = page.getByRole('dialog', {
			name: 'Update Wiki Space Routes',
		});
		await dialog
			.getByRole('textbox', { name: 'New Base Route' })
			.fill(newRoute);
		await dialog.getByRole('button', { name: 'Update Routes' }).click();

		await expect(dialog).toHaveCount(0);
		await expect(settings).toContainText(`/${newRoute}/`);
		const saved = await getDoc<{ route: string }>(
			request,
			'Wiki Space',
			space.name,
		);
		expect(saved.route).toBe(newRoute);

		// The factory cleans up by the route it seeded.
		await updateDoc(request, 'Wiki Space', space.name, { route: space.route });
	});

	test('Start Cloning sends the new route', async ({ page, wiki }) => {
		const space = await wiki.space({ pages: [{ title: 'Guide' }] });
		const newRoute = `${space.route}-copy`;
		let clonedTo: string | undefined;
		await page.route('**/api/method/run_doc_method', async (route) => {
			const body = route.request().postDataJSON();
			if (body?.method !== 'clone_wiki_space_in_background') {
				return route.continue();
			}
			clonedTo = body.args.new_space_route;
			return route.fulfill({ json: { docs: [], message: null } });
		});
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		const settings = await openGeneralSettings(page);
		await settings.getByRole('button', { name: 'Clone', exact: true }).click();

		const dialog = page.getByRole('dialog', { name: 'Clone Wiki Space' });
		await expect(
			dialog.getByRole('textbox', { name: 'New Space Route' }),
		).toHaveValue(newRoute);
		await dialog.getByRole('button', { name: 'Start Cloning' }).click();

		await expect(dialog).toHaveCount(0);
		await expect(page.getByText('Cloning started in background')).toBeVisible();
		expect(clonedTo).toBe(newRoute);
	});
});
