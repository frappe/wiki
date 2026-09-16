import { expect, test } from '../fixtures';

/**
 * Auto-generated OG (meta) images.
 *
 * A page with no uploaded meta_image emits an og:image pointing at
 * wiki.api.og_image.og_image, which screenshots a branded card with the
 * server-side headless Chromium. This is the only place that renderer is
 * exercised for real — every Python test patches it, since CI installs no
 * server-side Chromium.
 *
 * That renderer is therefore not guaranteed on the CI site: a 503 (another
 * worker holds the render lock) or a 404 (the render failed and is negatively
 * cached) is treated as "renderer unavailable" and skips the byte assertions.
 * The og:image tag itself is asserted unconditionally — that part is pure
 * template work and must never regress.
 */
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
			test.skip(true, 'No server-side Chromium on this site');
		}

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('image/jpeg');
		expect((await response.body()).byteLength).toBeGreaterThan(0);
	});
});
