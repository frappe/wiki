import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

/**
 * Sidebar rows carry no per-node Alpine: navigation and prefetch are delegated
 * off `data-route` from the navigation store. Delegation uses `mouseover`,
 * which fires far more often than the `mouseenter` it replaced, so prefetch
 * has to deduplicate in-flight requests as well as cached ones.
 */
async function buildSpace(
	request: import('@playwright/test').APIRequestContext,
	prefix: string,
) {
	const spaceRoute = `${prefix}-${Date.now()}`;
	const space = await createTestWikiSpace(request, {
		route: spaceRoute,
		is_published: true,
	});
	const rootGroup = await createTestWikiDocument(request, {
		title: 'Root',
		route: `${spaceRoute}/root`,
		is_group: true,
		is_published: true,
	});
	await updateDoc(request, 'Wiki Space', space.name, {
		root_group: rootGroup.name,
	});

	const group = await createTestWikiDocument(request, {
		title: 'A Group',
		route: `${spaceRoute}/a-group`,
		is_group: true,
		is_published: true,
		parent_wiki_document: rootGroup.name,
	});
	const nested = await createTestWikiDocument(request, {
		title: 'Nested Page',
		route: `${spaceRoute}/a-group/nested`,
		content: 'Nested.\n',
		is_published: true,
		parent_wiki_document: group.name,
	});
	const landing = await createTestWikiDocument(request, {
		title: 'Landing',
		route: `${spaceRoute}/landing`,
		content: 'Landing.\n',
		is_published: true,
		parent_wiki_document: rootGroup.name,
	});
	const sibling = await createTestWikiDocument(request, {
		title: 'Sibling',
		route: `${spaceRoute}/sibling`,
		content: 'Sibling.\n',
		is_published: true,
		parent_wiki_document: rootGroup.name,
	});

	return {
		space,
		cleanup: [sibling, landing, nested, group, rootGroup],
		landing,
		sibling,
	};
}

test.describe('Sidebar row events', () => {
	test('hovering a row prefetches it exactly once', async ({
		page,
		request,
	}) => {
		const built = await buildSpace(request, 'row-events');

		const prefetches: string[] = [];
		page.on('request', (r) => {
			if (r.url().includes('get_page_data') && r.method() === 'POST') {
				prefetches.push(r.postData() || '');
			}
		});

		try {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(`/${built.landing.route}`);
			await page.waitForLoadState('networkidle');

			const row = page.locator(
				`.wiki-sidebar .wiki-link[data-route="${built.sibling.route}"]`,
			);
			// Several pointer moves within the same row must still be one request:
			// mouseover repeats where mouseenter would not.
			await row.hover();
			await row.hover({ position: { x: 5, y: 5 } });
			await row.hover({ position: { x: 60, y: 12 } });
			await page.waitForTimeout(500);

			const forSibling = prefetches.filter((body) =>
				body.includes(`"${built.sibling.route}"`),
			);
			expect(forSibling).toHaveLength(1);
		} finally {
			for (const doc of built.cleanup) {
				await deleteTestWikiDocument(request, doc.name).catch(() => {});
			}
			await deleteTestWikiSpace(request, built.space.name).catch(() => {});
		}
	});

	test('clicking a group toggle expands it instead of navigating', async ({
		page,
		request,
	}) => {
		const built = await buildSpace(request, 'row-events-group');

		try {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(`/${built.landing.route}`);
			await page.waitForLoadState('networkidle');

			// A group toggle carries data-route too, but it is a <button> without
			// .wiki-link -- the delegated click handler must skip it.
			const group = page
				.locator('.wiki-sidebar button.wiki-item-content')
				.first();
			const expandedBefore = await group.getAttribute('aria-expanded');
			const urlBefore = page.url();

			await group.click();
			await expect(group).not.toHaveAttribute(
				'aria-expanded',
				expandedBefore ?? '',
			);
			expect(page.url()).toBe(urlBefore);
		} finally {
			for (const doc of built.cleanup) {
				await deleteTestWikiDocument(request, doc.name).catch(() => {});
			}
			await deleteTestWikiSpace(request, built.space.name).catch(() => {});
		}
	});
});
