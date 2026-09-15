import { expect, test } from '../fixtures';

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
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Embed Page', content: CONTENT }],
		});
		const doc = space.page('Embed Page');

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
	});
});
