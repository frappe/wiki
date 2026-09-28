import { expect, test } from '../fixtures';

/**
 * Disable Indexing on a page (#806).
 *
 * The switch in Page Settings writes the flag straight to the document. A
 * search engine sees the page as Guest: a robots noindex tag in the head and
 * no sitemap entry. Its sibling stays indexable.
 */
test('hides a page from search engines from page settings', async ({
	page,
	wiki,
	browser,
	baseURL,
}) => {
	const space = await wiki.space({
		// Guest Read makes the space public, so it is served and in the sitemap.
		roles: [{ role: 'Guest', permission_level: 'Read' }],
		pages: [{ title: 'Hidden Page' }, { title: 'Visible Page' }],
	});
	const hidden = space.page('Hidden Page');
	const visible = space.page('Visible Page');

	await page.setViewportSize({ width: 1200, height: 900 });
	await page.goto(space.url('page', hidden.name));
	await expect(page.getByPlaceholder('Page title')).toHaveValue(hidden.title, {
		timeout: 15000,
	});

	await page
		.getByRole('button', { name: 'Page settings', exact: true })
		.click();
	const panel = page.getByTestId('page-settings-panel');
	await expect(panel).toBeVisible({ timeout: 10000 });
	const indexingSwitch = panel.getByRole('switch', {
		name: 'Disable Indexing',
	});
	const saveButton = panel.getByRole('button', { name: 'Save', exact: true });

	await indexingSwitch.click();
	await saveButton.click();
	// A clean form is a saved one.
	await expect(saveButton).toBeDisabled({ timeout: 10000 });

	const guest = await browser.newContext({ baseURL });
	const guestPage = await guest.newPage();
	await guestPage.goto(`/${hidden.route}`);
	await expect(guestPage.locator('meta[name="robots"]')).toHaveAttribute(
		'content',
		'noindex',
	);
	await guestPage.goto(`/${visible.route}`);
	await expect(guestPage.locator('meta[name="robots"]')).toHaveCount(0);
	const sitemap = await (await guest.request.get('/sitemap.xml')).text();
	expect(sitemap).not.toContain(`/${hidden.route}<`);
	expect(sitemap).toContain(`/${visible.route}<`);

	// Turning it back off lifts the tag.
	await indexingSwitch.click();
	await saveButton.click();
	await expect(saveButton).toBeDisabled({ timeout: 10000 });
	await guestPage.goto(`/${hidden.route}`);
	await expect(guestPage.locator('meta[name="robots"]')).toHaveCount(0);
	await guest.close();
});
