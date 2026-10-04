import { expect, test } from '../fixtures';
import { SPACE_URL_RE, appUrl, spaceLinkSelector } from '../helpers/routes';

test.describe('Spaces -> publish filter', () => {
	test('keeps the Unpublished filter after going back from a space', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space({ is_published: false });

		await page.goto(appUrl('spaces'));
		const unpublished = page.getByRole('radio', { name: 'Unpublished' });
		await unpublished.click();

		await page.locator(spaceLinkSelector(space.name)).last().click();
		await expect(page).toHaveURL(SPACE_URL_RE);

		await page.goBack();
		await expect(unpublished).toBeChecked();
	});
});
