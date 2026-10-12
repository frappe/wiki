import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';
import { generateWikiTitle } from '../helpers/wiki';

/**
 * Bulk PDF Export and "Allow PDF Download" toggle tests.
 *
 * Exercises:
 * 1. Public Reader:
 *    - When "Allow PDF Download" is ON: Guest sees single page PDF, Space ZIP, and Merged PDF.
 *    - When "Allow PDF Download" is OFF: Guest sees NO download actions, even if "Accept Contributions" is ON.
 *    - Manager (write access) always retains PDF download capability.
 * 2. Workspace:
 *    - Space Settings Access tab exposes the "Allow PDF Download" toggle.
 *    - Space Sidebar menu offers both ZIP and Merged PDF download options.
 */
test.describe('Bulk PDF Export & Space Settings', () => {
	async function seedSpaceWithPDFSetting(
		wiki: WikiFactory,
		allowPdf: boolean,
		allowContributions = false,
	) {
		const title = generateWikiTitle('PDF Export Page');
		const space = await wiki.space({
			allow_pdf_download: allowPdf ? 1 : 0,
			allow_contributions: allowContributions ? 1 : 0,
			roles: [{ role: 'Guest', permission_level: 'Read' }],
			pages: [
				{ title, content: '# Test Page\n\nContent for PDF export testing.' },
			],
		});
		return { space, url: `/${space.page(title).route}` };
	}

	test('shows PDF and Bulk Export options in reader dropdown when PDF download is enabled', async ({
		wiki,
		browser,
		baseURL,
	}) => {
		const { url } = await seedSpaceWithPDFSetting(wiki, true, true);

		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		});
		const guestPage = await guest.newPage();
		await guestPage.setViewportSize({ width: 1100, height: 900 });
		await guestPage.goto(url);
		await guestPage.waitForLoadState('networkidle');

		// Open the page actions dropdown (desktop Edit dropdown toggle)
		const dropdownToggle = guestPage
			.locator(
				'[x-data="wikiDocument"] button[aria-haspopup="true"], [x-data="wikiDocument"] button:has(svg)',
			)
			.last();
		if (await dropdownToggle.isVisible()) {
			await dropdownToggle.click();
		}

		// Verify all 3 PDF download actions are present
		await expect(guestPage.getByText('Download Page').last()).toBeAttached();
		await expect(
			guestPage.getByText('Download Space (ZIP)').last(),
		).toBeAttached();
		await expect(
			guestPage.getByText('Download Space (Merged PDF)').last(),
		).toBeAttached();

		await guest.close();
	});

	test('hides all PDF download options from guest when PDF download is disabled (even with contributions ON)', async ({
		page,
		wiki,
		browser,
		baseURL,
	}) => {
		const { url } = await seedSpaceWithPDFSetting(wiki, false, true);

		// --- Guest context ---
		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		});
		const guestPage = await guest.newPage();
		await guestPage.setViewportSize({ width: 1100, height: 900 });
		await guestPage.goto(url);
		await guestPage.waitForLoadState('networkidle');

		// Open dropdown if present
		const dropdownToggle = guestPage
			.locator(
				'[x-data="wikiDocument"] button[aria-haspopup="true"], [x-data="wikiDocument"] button:has(svg)',
			)
			.last();
		if (await dropdownToggle.isVisible()) {
			await dropdownToggle.click();
		}

		// Ensure NONE of the download actions are attached to DOM for Guest
		await expect(guestPage.getByText('Download Page')).toHaveCount(0);
		await expect(guestPage.getByText('Download Space (ZIP)')).toHaveCount(0);
		await expect(
			guestPage.getByText('Download Space (Merged PDF)'),
		).toHaveCount(0);

		await guest.close();

		// --- Manager (Admin) context: can still see download options ---
		await page.setViewportSize({ width: 1100, height: 900 });
		await page.goto(url);
		await page.waitForLoadState('networkidle');

		const adminDropdown = page
			.locator(
				'[x-data="wikiDocument"] button[aria-haspopup="true"], [x-data="wikiDocument"] button:has(svg)',
			)
			.last();
		if (await adminDropdown.isVisible()) {
			await adminDropdown.click();
		}

		await expect(page.getByText('Download Page').last()).toBeAttached();
		await expect(page.getByText('Download Space (ZIP)').last()).toBeAttached();
		await expect(
			page.getByText('Download Space (Merged PDF)').last(),
		).toBeAttached();
	});

	test('exposes Allow PDF Download toggle in Space Settings Access tab', async ({
		page,
		wiki,
	}) => {
		const { space } = await seedSpaceWithPDFSetting(wiki, true);

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		// Open Space Settings dialog via Space actions menu
		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('tab', { name: 'Access', exact: true }).click();

		// Verify Allow PDF Download toggle section is present
		await expect(dialog.getByText('Allow PDF Download')).toBeVisible({
			timeout: 10000,
		});
		await expect(
			dialog.getByText('Allow readers to download the entire Space or Groups'),
		).toBeVisible();
	});

	test('space sidebar dropdown includes both ZIP and Merged PDF download options', async ({
		page,
		wiki,
	}) => {
		const { space } = await seedSpaceWithPDFSetting(wiki, true);

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		// Open the space sidebar menu via Space actions
		await page.getByRole('button', { name: 'Space actions' }).click();
		await expect(page.getByText('Download Space (ZIP)')).toBeVisible();
		await expect(page.getByText('Download Space (Merged PDF)')).toBeVisible();
	});
});
