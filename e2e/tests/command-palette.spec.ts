import { expect, test } from '../fixtures';
import { appUrl } from '../helpers/routes';

test.describe('Command Palette', () => {
	test('finds a page in another space and opens it', async ({ page, wiki }) => {
		const token = `Quillfeather${Date.now().toString(36)}`;
		const target = await wiki.space({
			space_name: `${token} Space`,
			pages: [{ title: `${token} Deploy Guide`, is_published: false }],
		});

		await page.goto(appUrl());
		const palette = page.getByRole('dialog');
		await expect(page.getByPlaceholder('Search spaces...')).toBeVisible({
			timeout: 10000,
		});

		await page.keyboard.press('ControlOrMeta+k');
		await expect(
			palette.getByRole('option', { name: 'All Spaces' }),
		).toBeVisible();

		await palette.getByRole('combobox').fill(`${token} deploy`);
		const result = palette.getByRole('option', {
			name: new RegExp(`${token} Deploy Guide`),
		});
		await expect(result).toBeVisible();
		const seeded = target.page(`${token} Deploy Guide`);
		await expect(result).toContainText(`/${seeded.route}`);

		await page.keyboard.press('Enter');
		await expect(palette).toBeHidden();
		await expect(page).toHaveURL(target.url('page', seeded.name));
	});

	test('opens a space by name, and closes on Escape', async ({
		page,
		wiki,
	}) => {
		const token = `Inkwell${Date.now().toString(36)}`;
		const target = await wiki.space({ space_name: `${token} Space` });

		await page.goto(appUrl());
		const palette = page.getByRole('dialog');
		await expect(page.getByPlaceholder('Search spaces...')).toBeVisible({
			timeout: 10000,
		});

		await page.keyboard.press('ControlOrMeta+k');
		await palette.getByRole('combobox').fill(token);
		await palette
			.getByRole('option', { name: new RegExp(`${token} Space`) })
			.click();
		await expect(page).toHaveURL(target.url());

		await page.keyboard.press('ControlOrMeta+k');
		await expect(palette.getByRole('combobox')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(palette).toBeHidden();
	});

	test('offers the pages the user opened, not the page they are on', async ({
		page,
		wiki,
	}) => {
		const token = `Larkspur${Date.now().toString(36)}`;
		const space = await wiki.space({
			space_name: `${token} Space`,
			pages: [{ title: `${token} Runbook` }, { title: `${token} Changelog` }],
		});

		await page.goto(space.url('page', space.page(`${token} Runbook`).name));
		await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 });
		await page.goto(space.url('page', space.page(`${token} Changelog`).name));
		await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 });

		const palette = page.getByRole('dialog');
		await page.keyboard.press('ControlOrMeta+k');
		const recent = palette.getByRole('group', { name: 'Recent' });
		await expect(recent.getByRole('option')).toHaveCount(1);
		await expect(recent.getByRole('option')).toContainText(`${token} Runbook`);
		await expect(recent.getByRole('option')).toContainText(`${token} Space`);

		await recent.getByRole('option').click();
		await expect(page).toHaveURL(
			space.url('page', space.page(`${token} Runbook`).name),
		);
	});

	test('keeps the highlighted row when a slower group loads above it', async ({
		page,
		wiki,
	}) => {
		const token = `Marlowe${Date.now().toString(36)}`;
		await wiki.space({
			space_name: `${token} Space`,
			pages: [{ title: `${token} Handbook` }],
		});

		// Hold the spaces request so its group lands above the selected page row.
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route('**/api/v2/document/Wiki%20Space*', async (route) => {
			await held;
			await route.continue();
		});

		await page.goto(appUrl());
		const palette = page.getByRole('dialog');
		await expect(page.getByPlaceholder('Search spaces...')).toBeVisible({
			timeout: 10000,
		});

		await page.keyboard.press('ControlOrMeta+k');
		await palette.getByRole('combobox').fill(token);
		const pageRow = palette
			.getByRole('group', { name: 'Pages' })
			.getByRole('option')
			.first();
		await expect(pageRow).toContainText(`${token} Handbook`);
		await page.keyboard.press('ArrowDown');
		await expect(pageRow).toHaveAttribute('aria-selected', 'true');

		release();
		await expect(palette.getByRole('group', { name: 'Spaces' })).toBeVisible();
		await expect(pageRow).toHaveAttribute('aria-selected', 'true');
	});

	test('shares the shortcut with the editor link popup', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({
			pages: [
				{
					title: 'Hello',
					content:
						'Welcome to the wiki\n\nRead the [docs](https://example.com)',
				},
			],
		});

		await page.goto(space.url('page', space.page('Hello').name));
		const editor = page.locator('.ProseMirror');
		await expect(editor).toContainText('Welcome to the wiki', {
			timeout: 10000,
		});
		const palette = page.getByRole('dialog');

		// Nothing selected: the palette opens.
		await editor.getByText('Welcome to the wiki').click();
		await page.keyboard.press('ControlOrMeta+k');
		await expect(palette.getByRole('combobox')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(palette).toBeHidden();

		// Selection: the link popup answers. Triple-click, since Home/Shift+End needs editor focus.
		await editor.getByText('Welcome to the wiki').click({ clickCount: 3 });
		await expect
			.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
			.toContain('Welcome to the wiki');
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByPlaceholder('https://example.com')).toBeVisible();
		await expect(palette).toBeHidden();
		await page.getByPlaceholder('https://example.com').press('Escape');
		await expect(
			editor.getByRole('link', { name: 'Welcome to the wiki' }),
		).toHaveCount(0);

		// A blank URL must not wrap the selection in a link either.
		await editor.getByText('Welcome to the wiki').click({ clickCount: 3 });
		await page.keyboard.press('ControlOrMeta+k');
		await page.getByPlaceholder('https://example.com').fill('   ');
		await page.getByPlaceholder('https://example.com').press('Enter');
		await expect(editor.locator('a[href=""]')).toHaveCount(0);

		// Cursor in a link: the popup answers, in view mode.
		await editor.getByRole('link', { name: 'docs' }).click();
		// The editor reads the click's selection asynchronously; wait for it to land in the link.
		await expect(
			page.getByRole('button', { name: 'Link', pressed: true }),
		).toBeVisible();
		await page.keyboard.press('ControlOrMeta+k');
		await expect(palette).toBeHidden();
		await page.getByRole('button', { name: 'Edit' }).click();
		await expect(page.getByPlaceholder('https://example.com')).toHaveValue(
			'https://example.com',
		);
	});
});
