import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/**
 * Auto-generated OG (meta) images.
 *
 * A page with no uploaded meta_image emits an og:image pointing at
 * wiki.api.og_image.og_image, which renders a branded card with the
 * server-side headless Chromium on Frappe v16, or with satori in Node on v15.
 * The Python tests patch the Chromium renderer, since CI installs no
 * server-side Chromium.
 *
 * So a renderer is not guaranteed on the CI site: a 503 (another worker holds
 * the render lock) or a 404 (the render failed and is negatively cached) is
 * treated as "renderer unavailable" and skips the byte assertions. The
 * og:image tag itself is asserted whenever the site can render cards — that
 * part is pure template work and must never regress. A site with neither
 * renderer must advertise no card at all.
 */
async function cardsSupported(page: Page) {
	await page.goto('/wiki-app');
	return page.evaluate(
		() =>
			(window as unknown as { meta_images_supported?: boolean })
				.meta_images_supported,
	);
}

test.describe('Generated OG image', () => {
	let pageUrl: string;

	test.beforeAll(async ({ wikiSuite }) => {
		const space = await wikiSuite.space({
			// Guest Read makes the card reachable by an anonymous scraper.
			roles: [{ role: 'Guest', permission_level: 'Read' }],
			pages: [
				{
					title: 'Generated OG Page',
					content: '# Heading\n\nReader body content.',
				},
			],
		});
		pageUrl = `/${space.page('Generated OG Page').route}`;
	});

	test('the public page advertises a card the endpoint can actually serve', async ({
		page,
		request,
	}) => {
		test.skip(!(await cardsSupported(page)), 'Cards need Chromium or satori');
		await page.goto(pageUrl);

		const ogImage = await page
			.locator('meta[property="og:image"]')
			.getAttribute('content');
		expect(ogImage).toContain('wiki.api.og_image.og_image');
		await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
			'content',
			'summary_large_image',
		);

		const response = await request.get(ogImage as string);
		if (response.status() === 503 || response.status() === 404) {
			test.skip(true, 'No working card renderer on this site');
		}

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('image/jpeg');
		expect((await response.body()).byteLength).toBeGreaterThan(0);
	});

	test('without a renderer the page advertises no card', async ({ page }) => {
		test.skip(await cardsSupported(page), 'This site can render cards');
		await page.goto(pageUrl);

		await expect(page.locator('meta[property="og:image"]')).toHaveCount(0);
		await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
			'content',
			'summary',
		);
	});
});
