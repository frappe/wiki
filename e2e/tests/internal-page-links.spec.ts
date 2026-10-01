import { expect, test } from '../fixtures';
import { updateDoc } from '../helpers/frappe';
import { saveEditor } from '../helpers/wiki';

/**
 * Typing "[[" links to a page by its doc_key, so the published link keeps
 * pointing at the page after its route changes. See specs/internal_page_links.md.
 */
test.describe('Internal page links', () => {
	test('a [[ link follows the target page to its new route', async ({
		page,
		request,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Link Source', content: 'Read this' },
				{
					title: 'Guides',
					is_group: true,
					children: [{ title: 'Setup Guide' }],
				},
			],
		});
		const source = space.page('Link Source');
		const target = space.page('Setup Guide');

		await page.goto(space.url('page', source.name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[setup');

		const menu = page.getByRole('listbox', { name: 'Link to a page' });
		await expect(menu.getByText('Guides', { exact: true })).toBeVisible();
		await expect(menu.getByText('Link Source', { exact: true })).toHaveCount(0);
		await page.keyboard.press('Enter');

		await expect(editor.locator(`a[href="wiki:${target.doc_key}"]`)).toHaveText(
			'Setup Guide',
		);

		await saveEditor(page);
		await page.getByRole('button', { name: 'Merge', exact: true }).click();
		await expect(
			page.locator('text=Change request merged').first(),
		).toBeVisible({ timeout: 15000 });

		const contentLink = page.locator('.prose').getByRole('link', {
			name: 'Setup Guide',
		});
		await page.goto(`/${source.route}`);
		await expect(contentLink).toHaveAttribute('href', `/${target.route}`);

		const movedRoute = `${space.route}/moved-setup`;
		await updateDoc(request, 'Wiki Document', target.name, {
			route: movedRoute,
		});
		await page.reload();
		await expect(contentLink).toHaveAttribute('href', `/${movedRoute}`);
	});

	test('backspace at the end of a link reopens the picker to retarget it', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Link Source', content: 'Read this' },
				{ title: 'Setup Guide' },
				{ title: 'Deploy Guide' },
			],
		});

		await page.goto(space.url('page', space.page('Link Source').name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[setup');
		await page.keyboard.press('Enter');
		await page.keyboard.type('first.');

		// Back to the end of the link, mid-sentence.
		for (let i = 0; i < ' first.'.length; i++) {
			await page.keyboard.press('ArrowLeft');
		}
		await page.keyboard.press('Backspace');
		await expect(editor).toContainText('Read this [[Setup Guide first.');
		const menu = page.getByRole('listbox', { name: 'Link to a page' });
		await expect(menu.getByText('Setup Guide', { exact: true })).toBeVisible();

		for (let i = 0; i < 'Setup Guide'.length; i++) {
			await page.keyboard.press('Backspace');
		}
		await page.keyboard.type('deploy');
		await page.keyboard.press('Enter');

		const deployKey = space.page('Deploy Guide').doc_key;
		await expect(editor.locator(`a[href="wiki:${deployKey}"]`)).toHaveText(
			'Deploy Guide',
		);
		await expect(editor.locator('a[href^="wiki:"]')).toHaveCount(1);
		// The retargeted link reuses the space after it, and typing goes past it.
		await page.keyboard.type('and then ');
		await expect(editor).toContainText(
			'Read this Deploy Guide and then first.',
		);
		await expect(editor.locator(`a[href="wiki:${deployKey}"]`)).toHaveText(
			'Deploy Guide',
		);
	});

	test('/linkpage opens the page picker', async ({ page, wiki }) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Link Source', content: 'Read this' },
				{ title: 'Setup Guide' },
			],
		});

		await page.goto(space.url('page', space.page('Link Source').name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' /linkpage');

		const slashMenu = page.locator('.slash-commands-list');
		await expect(
			slashMenu.getByText('Link to Page', { exact: true }),
		).toBeVisible();
		await page.keyboard.press('Enter');

		const menu = page.getByRole('listbox', { name: 'Link to a page' });
		await expect(menu.getByText('Setup Guide', { exact: true })).toBeVisible();
		await page.keyboard.type('setup');
		await page.keyboard.press('Enter');

		const setupKey = space.page('Setup Guide').doc_key;
		await expect(editor.locator(`a[href="wiki:${setupKey}"]`)).toHaveText(
			'Setup Guide',
		);
		await expect(editor).toContainText('Read this Setup Guide');
	});

	test('typing the closing brackets links an exact title', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{ title: 'Link Source', content: 'Read this' },
				{ title: 'Setup Guide' },
			],
		});

		await page.goto(space.url('page', space.page('Link Source').name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[setup guide]]');

		const setupKey = space.page('Setup Guide').doc_key;
		await expect(editor.locator(`a[href="wiki:${setupKey}"]`)).toHaveText(
			'Setup Guide',
		);
		await expect(editor).not.toContainText('[[');
	});

	test('the picker creates a missing page and links it', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Link Source', content: 'Read this' }],
		});

		await page.goto(space.url('page', space.page('Link Source').name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' [[Release Notes');

		const menu = page.getByRole('listbox', { name: 'Link to a page' });
		await expect(menu.getByText('No page matches.')).toBeVisible();
		await page.keyboard.press('Enter');

		// The title goes in at once; the link waits for the page's real key.
		const link = editor.locator('a[href^="wiki:"]');
		await expect(link).toHaveText('Release Notes');
		await expect(link).not.toHaveAttribute('href', /wiki:tmp_/);
		await expect(
			page.locator('aside').getByText('Release Notes', { exact: true }),
		).toBeVisible();
	});

	test('a created page is linked even if text before it changes meanwhile', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [{ title: 'Link Source', content: 'Read this' }],
		});

		await page.goto(space.url('page', space.page('Link Source').name));
		const editor = page.locator('.ProseMirror').first();
		await editor.click();

		// Hold the create long enough to edit around it.
		await page.route('**/*apply_cr_operations*', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			await route.continue();
		});

		await page.keyboard.press('End');
		await page.keyboard.type(' [[Release Notes');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Home');
		await page.keyboard.type('Now ');

		const link = editor.locator('a[href^="wiki:"]');
		await expect(link).toHaveText('Release Notes', { timeout: 15000 });
		await expect(editor).toContainText('Now Read this Release Notes');
	});
});
