import { expect, test } from '@playwright/test';
import { createDoc, getDoc } from '../helpers/frappe';
import {
	type WikiSpace,
	cleanupWikiSpacesByRoute,
	createTestWikiDocument,
} from '../helpers/wiki';

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
	const route = `generated-og-${Date.now()}`;
	let pageUrl: string;

	test.beforeAll(async ({ request }) => {
		const space = await createDoc<WikiSpace & { root_group: string }>(
			request,
			'Wiki Space',
			{
				route,
				space_name: route,
				is_published: true,
				// Guest Read makes the card reachable by an anonymous scraper.
				roles: [{ role: 'Guest', permission_level: 'Read' }],
			},
		);

		const doc = await createTestWikiDocument(request, {
			title: 'Generated OG Page',
			content: '# Heading\n\nReader body content.',
			is_published: true,
			wiki_space: space.name,
			parent_wiki_document: space.root_group,
		});

		// The controller computes the final stored route; read it back.
		const stored = await getDoc<{ route: string }>(
			request,
			'Wiki Document',
			doc.name,
		);
		pageUrl = `/${stored.route}`;
	});

	test.afterAll(async ({ request }) => {
		await cleanupWikiSpacesByRoute(request, route);
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
