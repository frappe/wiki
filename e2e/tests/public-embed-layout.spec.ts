import { expect, test } from '@playwright/test';
import { updateDoc } from '../helpers/frappe';
import {
	createTestWikiDocument,
	createTestWikiSpace,
	deleteTestWikiDocument,
	deleteTestWikiSpace,
} from '../helpers/wiki';

/**
 * Authors paste whatever dimensions the provider's share dialog hands them, and
 * those get stored verbatim. This fixture is the shape that caused frappe/wiki's
 * letterboxed embeds: 800x473 is ratio 1.69, not 16:9, so YouTube pads the video
 * with black bars — and 800px is wider than the article column, so it overflows
 * flush-left. The reader has to ignore both numbers.
 *
 * Only a browser can prove this: the markup is unchanged, it's the used box that
 * has to come out right.
 */
const CONTENT =
	'<iframe width="800" height="473.33333333" ' +
	'src="https://www.youtube.com/embed/QDia3e12czc" ' +
	'title="YouTube video player" frameborder="0" allowfullscreen></iframe>';

test.describe('Public reader embed layout', () => {
	test('renders a mis-sized embed as a centered 16:9 box', async ({
		page,
		request,
	}) => {
		const spaceRoute = `embed-layout-space-${Date.now()}`;
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
		const doc = await createTestWikiDocument(request, {
			title: 'Embed Page',
			route: `${spaceRoute}/embed`,
			content: CONTENT,
			is_published: true,
			parent_wiki_document: rootGroup.name,
		});

		try {
			// Wide enough that the 720px cap leaves visible slack on both sides,
			// so the centering assertion below is actually measuring something.
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.goto(`/${doc.route}`);
			await page.waitForLoadState('networkidle');

			const frame = page.locator('#wiki-content iframe');
			await expect(frame).toBeVisible();

			const box = await frame.boundingBox();
			const column = await page.locator('#wiki-content').boundingBox();
			expect(box).not.toBeNull();
			expect(column).not.toBeNull();
			if (!box || !column) return;

			// The authored 800px must not win over the column.
			expect(box.width).toBeLessThanOrEqual(720);

			// The bars are gone only if the box is exactly 16:9.
			expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);

			const leftGap = box.x - column.x;
			const rightGap = column.x + column.width - (box.x + box.width);
			expect(leftGap).toBeGreaterThan(0);
			expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
		} finally {
			await deleteTestWikiDocument(request, doc.name).catch(() => {});
			await deleteTestWikiDocument(request, rootGroup.name).catch(() => {});
			await deleteTestWikiSpace(request, space.name).catch(() => {});
		}
	});
});
