import { expect, test } from '../fixtures';
import { createDoc } from '../helpers/frappe';

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

	// Sidebar navigation swaps the page in place, so the tag must follow it.
	await guestPage.setViewportSize({ width: 1280, height: 900 });
	const sidebarLink = (route: string) =>
		guestPage.locator(`.wiki-sidebar a[data-route="${route}"]`);
	await sidebarLink(hidden.route).click();
	await expect(guestPage).toHaveURL(`/${hidden.route}`);
	await expect(guestPage.locator('meta[name="robots"]')).toHaveAttribute(
		'content',
		'noindex',
	);
	await sidebarLink(visible.route).click();
	await expect(guestPage).toHaveURL(`/${visible.route}`);
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

/**
 * A git-synced page denies document writes, but the repo never carries the
 * meta fields, so a space writer who is not an Administrator still saves them.
 */
test('a space writer hides a git-synced page from search engines', async ({
	browser,
	request,
	wiki,
	baseURL,
}) => {
	const stamp = Date.now().toString(36);
	const email = `e2e-writer-${stamp}@example.com`;
	const password = `Writer-${stamp}!`;
	await createDoc(request, 'User', {
		email,
		first_name: 'E2E Writer',
		new_password: password,
		send_welcome_email: 0,
		roles: [{ role: 'Wiki User' }],
	});
	const space = await wiki.space({
		git_synced: 1,
		repo_full_name: 'frappe/wiki',
		branch: 'main',
		last_sync_status: 'Success',
		// Set so the space does not start a real sync against GitHub.
		last_sync_time: '2026-01-01 00:00:00',
		roles: [
			{ role: 'Guest', permission_level: 'Read' },
			{ role: 'Wiki User', permission_level: 'Write' },
		],
		pages: [{ title: 'Synced Page' }],
	});
	const synced = space.page('Synced Page');

	const context = await browser.newContext({ baseURL });
	const login = await context.request.post('/api/method/login', {
		form: { usr: email, pwd: password },
	});
	expect(login.ok()).toBeTruthy();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.goto(space.url('page', synced.name));
	await page
		.getByRole('button', { name: 'Page settings', exact: true })
		.click();
	const panel = page.getByTestId('page-settings-panel');
	const saveButton = panel.getByRole('button', { name: 'Save', exact: true });
	await panel.getByRole('switch', { name: 'Disable Indexing' }).click();
	await saveButton.click();
	await expect(page.getByText('Page settings saved')).toBeVisible();
	await expect(saveButton).toBeDisabled();

	await page.goto(`/${synced.route}`);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
		'content',
		'noindex',
	);
	await context.close();
});
