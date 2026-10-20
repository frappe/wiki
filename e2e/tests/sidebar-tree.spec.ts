import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { SeededPage } from '../helpers/factory';

/**
 * The reader ships the tree once, with plain rows and one delegated listener.
 * The mobile sheet borrows the desktop sidebar's tree instead of a copy.
 */
test.describe('Reader sidebar tree', () => {
	let deepPage: SeededPage;
	let faqPage: SeededPage;
	let referenceGroup: SeededPage;

	test.beforeAll(async ({ wikiSuite }) => {
		const space = await wikiSuite.space({
			pages: [
				{ title: 'Getting Started' },
				{
					title: 'Guides',
					is_group: true,
					children: [
						{
							title: 'Advanced',
							is_group: true,
							children: [{ title: 'Deep Page' }],
						},
					],
				},
				{ title: 'Reference', is_group: true, children: [{ title: 'API' }] },
				{ title: 'FAQ' },
			],
		});
		deepPage = space.page('Deep Page');
		faqPage = space.page('FAQ');
		referenceGroup = space.page('Reference');
	});

	const sidebar = (page: Page) => page.locator('.wiki-sidebar');

	test('page HTML carries one copy of the tree', async ({ page }) => {
		const response = await page.request.get(`/${deepPage.route}`);
		const html = await response.text();

		const copies = html.match(
			new RegExp(`data-node-id="${referenceGroup.name}"`, 'g'),
		);
		expect(copies).toHaveLength(1);
	});

	test('a group stays open or closed across reloads', async ({ page }) => {
		await page.goto(`/${deepPage.route}`);
		const api = sidebar(page).getByRole('link', { name: 'API', exact: true });
		await expect(api).toBeHidden();

		await sidebar(page).getByText('Reference', { exact: true }).click();
		await expect(api).toBeVisible();
		await page.reload();
		await expect(api).toBeVisible();

		await sidebar(page).getByText('Reference', { exact: true }).click();
		await expect(api).toBeHidden();
		await page.reload();
		await expect(api).toBeHidden();
	});

	test('a page link navigates in place and moves the highlight', async ({
		page,
	}) => {
		await page.goto(`/${deepPage.route}`);
		await page.evaluate(() => {
			(window as unknown as { samePage: boolean }).samePage = true;
		});
		const deep = sidebar(page).getByRole('link', { name: 'Deep Page' });
		await expect(deep).toHaveAttribute('aria-current', 'page');

		const faq = sidebar(page).getByRole('link', { name: 'FAQ' });
		await faq.click();

		await page.waitForURL(`**/${faqPage.route}`);
		await expect(page.locator('#wiki-page-title')).toHaveText('FAQ');
		await expect(faq).toHaveAttribute('aria-current', 'page');
		await expect(deep).not.toHaveAttribute('aria-current', 'page');
		expect(
			await page.evaluate(
				() => (window as unknown as { samePage?: boolean }).samePage,
			),
		).toBe(true);
	});

	test('the tree still works when the browser blocks storage', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'localStorage', {
				get() {
					throw new DOMException('Storage is blocked', 'SecurityError');
				},
			});
		});
		await page.goto(`/${deepPage.route}`);
		await page.evaluate(() => {
			(window as unknown as { samePage: boolean }).samePage = true;
		});

		await sidebar(page).getByText('Reference', { exact: true }).click();
		await expect(
			sidebar(page).getByRole('link', { name: 'API', exact: true }),
		).toBeVisible();

		await sidebar(page).getByRole('link', { name: 'FAQ' }).click();
		await expect(page.locator('#wiki-page-title')).toHaveText('FAQ');
		await expect(
			sidebar(page).getByRole('link', { name: 'FAQ' }),
		).toHaveAttribute('aria-current', 'page');
		expect(
			await page.evaluate(
				() => (window as unknown as { samePage?: boolean }).samePage,
			),
		).toBe(true);
	});

	test('a modifier click opens the page in a new tab', async ({ page }) => {
		await page.goto(`/${deepPage.route}`);

		const [newTab] = await Promise.all([
			page.context().waitForEvent('page'),
			sidebar(page)
				.getByRole('link', { name: 'FAQ' })
				.click({ modifiers: ['ControlOrMeta'] }),
		]);

		await newTab.waitForURL(`**/${faqPage.route}`);
		await expect(page).toHaveURL(new RegExp(`/${deepPage.route}$`));
	});

	test('the mobile sheet borrows the tree and gives it back', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/${deepPage.route}`);

		await page.getByTestId('mobile-menu-toggle').click();
		const sheet = page.getByTestId('mobile-bottom-sheet');
		const deep = sheet.getByRole('link', { name: 'Deep Page' });
		await expect(deep).toBeVisible();
		await expect(deep).toHaveAttribute('aria-current', 'page');
		await expect(deep).toHaveCSS('height', '44px');

		await page.getByTestId('mobile-nav-search').fill('api');
		await expect(sheet.getByRole('link', { name: 'API' })).toBeVisible();
		await expect(sheet.getByRole('link', { name: 'FAQ' })).toBeHidden();

		await sheet.getByRole('link', { name: 'API' }).click();
		await expect(sheet).toBeHidden();
		await expect(page.locator('#wiki-page-title')).toHaveText('API');

		await page.getByTestId('mobile-menu-toggle').click();
		await expect(sheet.getByRole('link', { name: 'FAQ' })).toBeVisible();
		await page.setViewportSize({ width: 1280, height: 800 });

		const api = sidebar(page).getByRole('link', { name: 'API' });
		await expect(api).toBeVisible();
		await expect(api).toHaveAttribute('aria-current', 'page');
		await expect(api).toHaveCSS('height', '28px');
	});
});
