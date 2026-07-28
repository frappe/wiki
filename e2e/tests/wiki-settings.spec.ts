import { expect, test } from '@playwright/test';
import { getDoc, updateDoc } from '../helpers/frappe';
import { APP_BASE } from '../helpers/routes';

/**
 * Global Wiki Settings dialog (admin-only, front-end).
 *
 * The site-wide Wiki Settings singleton used to be editable only from the Desk.
 * It now opens as a dialog inside the SPA for Wiki Managers. We open it via the
 * GitHub-App return param (?github_app_created=1) — deterministic, and it also
 * exercises that redirect handler — then verify the tabs render and that a
 * General toggle round-trips to the backend.
 *
 * The stored auth state is Administrator (System Manager → Wiki Manager), so the
 * dialog and its trigger are available.
 */
test.describe('Global Wiki Settings', () => {
	test('admin opens settings and a General toggle persists', async ({
		page,
		request,
	}) => {
		const original = await getDoc<{ enable_table_of_contents: number }>(
			request,
			'Wiki Settings',
			'Wiki Settings',
		);
		const before = Boolean(original.enable_table_of_contents);

		await page.setViewportSize({ width: 1100, height: 900 });
		await page.goto(`${APP_BASE}?github_app_created=1`);
		await page.waitForLoadState('networkidle');

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 10000 });
		await expect(dialog.getByText('Wiki Settings')).toBeVisible();

		// All four tabs are present. The settings nav is a real ARIA tablist
		// (frappe-ui SettingsDialog is built on reka-ui Tabs).
		for (const tab of [
			'General',
			'Feedback',
			'Header & Robots',
			'GitHub Sync',
		]) {
			await expect(
				dialog.getByRole('tab', { name: tab, exact: true }),
			).toBeVisible();
		}

		// Toggle "Enable Table of Contents" on the General tab.
		await dialog.getByRole('tab', { name: 'General', exact: true }).click();
		const tocSwitch = dialog.getByRole('switch').first();
		await expect(tocSwitch).toBeVisible();
		await tocSwitch.click();
		await expect(tocSwitch).toHaveAttribute('aria-checked', String(!before));

		// It persisted to the backend singleton.
		await expect
			.poll(async () => {
				const doc = await getDoc<{ enable_table_of_contents: number }>(
					request,
					'Wiki Settings',
					'Wiki Settings',
				);
				return Boolean(doc.enable_table_of_contents);
			})
			.toBe(!before);

		// Restore the original value so the run is idempotent.
		await updateDoc(request, 'Wiki Settings', 'Wiki Settings', {
			enable_table_of_contents: before ? 1 : 0,
		});
	});

	test('admin opens settings from the sidebar menu', async ({ page }) => {
		await page.setViewportSize({ width: 1100, height: 900 });
		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		// The sidebar header is a dropdown trigger labelled with the app title.
		await page.getByRole('button', { name: 'Frappe Wiki' }).click();
		await page.getByRole('menuitem', { name: 'Settings' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible({ timeout: 10000 });
		await expect(
			dialog.getByRole('tab', { name: 'General', exact: true }),
		).toBeVisible();
	});
});
