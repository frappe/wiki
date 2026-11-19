import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';
import { callMethod } from '../helpers/frappe';

const CR_METHOD =
	'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

const TITLES = {
	short: 'Fix typo',
	spaced: 'Update the install guide for every supported version '
		.repeat(3)
		.slice(0, 140)
		.trimEnd(),
	unbroken: 'A'.repeat(140),
};

async function openReview(
	page: Page,
	request: APIRequestContext,
	wiki: WikiFactory,
	title: string,
) {
	const space = await wiki.space({ pages: [{ title: 'Home' }] });
	const { name } = await callMethod<{ name: string }>(
		request,
		`${CR_METHOD}.create_change_request`,
		{ wiki_space: space.name, title },
	);
	await callMethod(request, `${CR_METHOD}.update_cr_page`, {
		name,
		doc_key: space.page('Home').doc_key,
		fields: { content: 'Changed on a phone.' },
	});
	await callMethod(request, `${CR_METHOD}.submit_change_request`, { name });
	await page.goto(`/wiki-app/spaces/${space.name}/change-requests/${name}`);
	await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page, title: string) {
	const heading = page.getByRole('heading', { level: 1, name: title });
	await expect(heading).toBeVisible();
	const overflow = await heading.evaluate((el) => {
		const scroller = el.closest('.overflow-auto') as HTMLElement;
		const root = document.documentElement;
		return {
			heading: el.scrollWidth - el.clientWidth,
			scroller: scroller.scrollWidth - scroller.clientWidth,
			page: root.scrollWidth - root.clientWidth,
		};
	});
	expect(overflow).toEqual({ heading: 0, scroller: 0, page: 0 });
}

test.describe('Change request review on a phone', () => {
	for (const [kind, title] of Object.entries(TITLES)) {
		for (const width of [320, 390]) {
			test(`${kind} title stays readable at ${width}px`, async ({
				page,
				request,
				wiki,
			}) => {
				await page.setViewportSize({ width, height: 800 });
				await openReview(page, request, wiki, title);

				await expectNoSidewaysScroll(page, title);
				await expect(
					page.getByRole('heading', { level: 1, name: title }),
				).toBeInViewport({ ratio: 1 });

				// The crumb could only ever show a few letters of the heading below it.
				await expect(page.locator(`[title="${title}"]`)).toHaveCount(0);
				await expect(
					page.getByRole('link', { name: 'Change requests', exact: true }),
				).toBeInViewport({ ratio: 1 });

				for (const name of ['Edit', 'Approve', 'More actions']) {
					await expect(
						page.getByRole('button', { name, exact: true }),
					).toBeInViewport({ ratio: 1 });
				}
			});
		}
	}

	test('a title with no spaces wraps on a wide screen too', async ({
		page,
		request,
		wiki,
	}) => {
		await page.setViewportSize({ width: 1100, height: 800 });
		await openReview(page, request, wiki, TITLES.unbroken);

		await expectNoSidewaysScroll(page, TITLES.unbroken);
		await expect(page.locator(`[title="${TITLES.unbroken}"]`)).toHaveCount(1);
	});
});
