import { expect, test } from '@playwright/test';
import { getList } from '../helpers/frappe';
import {
	APP_BASE,
	CHANGE_REQUEST_URL_RE,
	spaceLinkSelector,
} from '../helpers/routes';
import {
	clickSidebarAddOption,
	publishChangeRequestFromReview,
} from '../helpers/wiki';

interface WikiDocumentRoute {
	route: string;
	doc_key: string;
}

declare global {
	interface Window {
		wikiEditor: {
			commands: {
				setContent: (
					content: string,
					options?: { contentType?: string },
				) => void;
			};
		};
	}
}

/**
 * Regression test for #699.
 *
 * The "Open in ChatGPT/Claude" page action bound its href once at render time
 * via Alpine's `:href`. `window.location` is not reactive, and SPA sidebar
 * navigation only refreshes the content/title/edit-links — never the AI links.
 * So after navigating from page A to page B the link still pointed at page A
 * until a full reload. The fix recomputes the href on click. This test drives
 * the real path: navigate A -> B via the sidebar, then assert the AI link
 * encodes page B's URL, not page A's.
 */
test.describe('Page actions – AI link URL', () => {
	test('Open in ChatGPT uses the current page URL after sidebar navigation', async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1100, height: 900 });

		await page.goto(APP_BASE);
		await page.waitForLoadState('networkidle');

		const spaceLink = page.locator(spaceLinkSelector()).first();
		await expect(spaceLink).toBeVisible({ timeout: 5000 });
		await spaceLink.click();
		await page.waitForLoadState('networkidle');

		const editor = page.locator('.ProseMirror, [contenteditable="true"]');

		// --- Create and fill the first page ---
		const firstPageTitle = `ai-url-first-${Date.now()}`;
		const createFirstPage = page.locator(
			'button:has-text("Create First Page")',
		);
		if (await createFirstPage.isVisible({ timeout: 2000 }).catch(() => false)) {
			await createFirstPage.click();
		} else {
			await clickSidebarAddOption(page, 'New Page');
		}
		await page.getByLabel('Title').fill(firstPageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		await page
			.locator('aside')
			.getByText(firstPageTitle, { exact: true })
			.click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const firstDocKey = decodeURIComponent(
			page.url().match(/\/draft\/([^/?#]+)/)?.[1] ?? '',
		);
		expect(firstDocKey).not.toBe('');

		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => window.wikiEditor !== undefined, {
			timeout: 10000,
		});
		await page.evaluate(() => {
			window.wikiEditor.commands.setContent('First page body.', {
				contentType: 'markdown',
			});
		});
		await editor.click();
		await page.waitForTimeout(500);
		await page.click('button:has-text("Save")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		// --- Create and fill the second page ---
		const secondPageTitle = `ai-url-second-${Date.now()}`;
		await clickSidebarAddOption(page, 'New Page');
		await page.getByLabel('Title').fill(secondPageTitle);
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Save' })
			.click();
		await page.waitForLoadState('networkidle');

		await page
			.locator('aside')
			.getByText(secondPageTitle, { exact: true })
			.click();
		await page.waitForURL(/\/draft\/[^/?#]+/);
		const secondDocKey = decodeURIComponent(
			page.url().match(/\/draft\/([^/?#]+)/)?.[1] ?? '',
		);
		expect(secondDocKey).not.toBe('');

		await expect(editor).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(
			() => window.wikiEditor?.commands?.setContent !== undefined,
			{ timeout: 10000 },
		);
		await page.waitForTimeout(500);
		await page.evaluate(() => {
			window.wikiEditor.commands.setContent('Second page body.', {
				contentType: 'markdown',
			});
		});
		await editor.click();
		await page.waitForTimeout(500);
		await page.click('button:has-text("Save")');
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(2000);

		// --- Submit for review and publish both pages ---
		await page.getByRole('button', { name: 'Submit for Review' }).click();
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page).toHaveURL(CHANGE_REQUEST_URL_RE, {
			timeout: 10000,
		});
		await publishChangeRequestFromReview(page);

		// --- Resolve public routes ---
		const [firstRoutes, secondRoutes] = await Promise.all([
			getList<WikiDocumentRoute>(request, 'Wiki Document', {
				fields: ['route', 'doc_key'],
				filters: { doc_key: firstDocKey },
				limit: 1,
			}),
			getList<WikiDocumentRoute>(request, 'Wiki Document', {
				fields: ['route', 'doc_key'],
				filters: { doc_key: secondDocKey },
				limit: 1,
			}),
		]);
		expect(firstRoutes.length).toBe(1);
		expect(secondRoutes.length).toBe(1);
		const firstRoute = firstRoutes[0].route;
		const secondRoute = secondRoutes[0].route;

		// --- Open first public page, then SPA-navigate to the second via sidebar ---
		const publicPage = await page.context().newPage();
		await publicPage.setViewportSize({ width: 1100, height: 900 });
		await publicPage.goto(`/${firstRoute}`);
		await publicPage.waitForLoadState('networkidle');

		const secondPageLink = publicPage
			.locator('.wiki-sidebar')
			.locator(`.wiki-link:has-text("${secondPageTitle}")`);
		await expect(secondPageLink).toBeVisible({ timeout: 5000 });
		await secondPageLink.click();

		// SPA navigation done: title (and URL) now reflect the second page.
		await expect(publicPage.locator('#wiki-page-title')).toHaveText(
			secondPageTitle,
			{ timeout: 10000 },
		);
		expect(publicPage.url()).toContain(`/${secondRoute}`);

		// Block the AI link from actually opening chatgpt.com (no external network
		// in CI). The capture-phase preventDefault stops the browser navigation but
		// still lets Alpine's @click handler run and recompute the href.
		await publicPage.evaluate(() => {
			document.addEventListener(
				'click',
				(e) => {
					const anchor = (e.target as HTMLElement)?.closest?.(
						'a[target="_blank"]',
					);
					if (anchor) e.preventDefault();
				},
				true,
			);
		});

		// Open the page-actions dropdown (toggle button sits next to the edit link).
		const editLink = publicPage.locator('a.wiki-edit-link:visible');
		await expect(editLink).toBeVisible({ timeout: 5000 });
		await editLink.locator('xpath=following-sibling::button').click();

		const aiLink = publicPage.locator('a:has-text("Open in ChatGPT"):visible');
		await expect(aiLink).toBeVisible({ timeout: 5000 });
		await aiLink.click();

		const decodedHref = decodeURIComponent(
			(await aiLink.getAttribute('href')) ?? '',
		);
		// The prompt must reference the current (second) page, not the first.
		expect(decodedHref).toContain(`/${secondRoute}`);
		expect(decodedHref).not.toContain(`/${firstRoute}`);

		await publicPage.close();
	});
});
