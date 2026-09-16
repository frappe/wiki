import { expect, test } from '../fixtures';
import type { SeededPage, SeededSpace } from '../helpers/factory';

/**
 * Page settings panel (per-page SEO meta fields).
 *
 * The panel is toggled from the page header in the editor SPA and saves
 * `meta_title` / `meta_description` (+ `meta_image`, not covered here — see
 * spec) directly on the Wiki Document. This spec covers the tracer path end
 * to end: open the panel, save, reopen to confirm persistence, then verify
 * the public page head actually emits the og/description/canonical tags —
 * and falls back to the page title when the fields are cleared.
 */
test.describe('Page settings meta fields', () => {
	let space: SeededSpace;
	let doc: SeededPage;

	test.beforeAll(async ({ wikiSuite }) => {
		space = await wikiSuite.space({ pages: [{ title: 'Meta Fields Page' }] });
		doc = space.page('Meta Fields Page');
	});

	test('saves meta fields from the panel, persists them, and reflects on the public page', async ({
		page,
	}) => {
		const metaTitle = `Meta Title ${Date.now()}`;
		const metaDescription = 'A hand-written meta description for e2e coverage.';

		await page.setViewportSize({ width: 1200, height: 900 });
		await page.goto(space.url('page', doc.name));
		await expect(page.getByPlaceholder('Page title')).toHaveValue(doc.title, {
			timeout: 15000,
		});

		// The panel is a header toggle, not a menu item.
		const panel = page.getByTestId('page-settings-panel');
		// `exact` matters: the panel's own close button is "Close page settings",
		// which a substring match would pick up too.
		const settingsToggle = page.getByRole('button', {
			name: 'Page settings',
			exact: true,
		});
		await settingsToggle.click();
		await expect(panel).toBeVisible({ timeout: 10000 });

		const saveButton = panel.getByRole('button', {
			name: 'Save',
			exact: true,
		});
		const metaTitleInput = panel.getByLabel('Meta title');
		const metaDescriptionInput = panel.getByLabel('Meta description');

		// Clean, freshly-opened panel: nothing to save yet.
		await expect(saveButton).toBeDisabled();

		await metaTitleInput.fill(metaTitle);
		await metaDescriptionInput.fill(metaDescription);
		await expect(saveButton).toBeEnabled();

		await saveButton.click();
		// Save disabling itself is the signal the write landed: the panel is a
		// form measured against the saved values, so a clean form is a saved one.
		await expect(saveButton).toBeDisabled({ timeout: 10000 });
		await expect(panel).toBeVisible();
		await panel.getByRole('button', { name: 'Close page settings' }).click();
		await expect(panel).not.toBeVisible({ timeout: 10000 });

		// Reopen — values must have persisted to the Wiki Document.
		await settingsToggle.click();
		await expect(panel).toBeVisible({ timeout: 10000 });
		await expect(panel.getByLabel('Meta title')).toHaveValue(metaTitle);
		await expect(panel.getByLabel('Meta description')).toHaveValue(
			metaDescription,
		);
		await panel.getByRole('button', { name: 'Close page settings' }).click();
		await expect(panel).not.toBeVisible({ timeout: 10000 });

		// Public page head: og:title carries the meta title, a plain
		// description meta tag is present, and the canonical link is emitted.
		await page.goto(`/${doc.route}`);
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			metaTitle,
		);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute(
			'content',
			metaDescription,
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			new RegExp(`/${doc.route}$`),
		);

		// Clear both fields — the public page must fall back to the page
		// title in og:title, and drop the now-empty description tag rather
		// than emit an empty one.
		await page.goto(space.url('page', doc.name));
		await expect(page.getByPlaceholder('Page title')).toHaveValue(doc.title, {
			timeout: 15000,
		});
		await settingsToggle.click();
		await expect(panel).toBeVisible({ timeout: 10000 });
		await panel.getByLabel('Meta title').fill('');
		await panel.getByLabel('Meta description').fill('');
		await expect(saveButton).toBeEnabled();
		await saveButton.click();
		await expect(saveButton).toBeDisabled({ timeout: 10000 });
		await panel.getByRole('button', { name: 'Close page settings' }).click();
		await expect(panel).not.toBeVisible({ timeout: 10000 });

		await page.goto(`/${doc.route}`);
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			doc.title,
		);
		await expect(page.locator('meta[name="description"]')).toHaveCount(0);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			new RegExp(`/${doc.route}$`),
		);
	});
});
