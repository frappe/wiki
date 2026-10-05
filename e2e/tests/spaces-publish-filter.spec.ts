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

		// The sidebar holds a hidden link to the same space, so wait for the list row.
		await page.locator(`${spaceLinkSelector(space.name)}[role="row"]`).click();
		await expect(page).toHaveURL(SPACE_URL_RE);

		await page.goBack();
		await expect(unpublished).toBeChecked();
	});
});
