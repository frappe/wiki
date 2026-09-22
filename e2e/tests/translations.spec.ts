import { expect, test } from '../fixtures';
import { createDoc, deleteDoc, updateDoc } from '../helpers/frappe';
import { APP_BASE } from '../helpers/routes';

type TranslationDoc = { name: string };

test.describe('Translations', () => {
	// The catalog lands after the first paint. Chrome that already rendered has
	// to pick it up anyway, which is what regressed: it used to stay English for
	// the rest of the session while later views rendered translated.
	test('reach chrome that rendered before the catalog arrived', async ({
		page,
		request,
	}) => {
		const translation = await createDoc<TranslationDoc>(
			request,
			'Translation',
			{
				language: 'es',
				source_text: 'All Spaces',
				translated_text: 'Todos los espacios de prueba',
			},
		);

		try {
			await updateDoc(request, 'User', 'Administrator', { language: 'es' });

			// Long enough that the sidebar is certainly painted first.
			await page.route('**/wiki.api.get_translations*', async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				await route.continue();
			});
			await page.goto(APP_BASE);

			// It paints in the source language...
			await expect(
				page.getByRole('link', { name: 'All Spaces', exact: true }),
			).toBeVisible();

			// ...and corrects itself once the catalog lands.
			await expect(
				page.getByRole('link', {
					name: 'Todos los espacios de prueba',
					exact: true,
				}),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await updateDoc(request, 'User', 'Administrator', { language: '' });
			await deleteDoc(request, 'Translation', translation.name);
		}
	});

	test('fall back to source strings when the catalog cannot be loaded', async ({
		page,
	}) => {
		await page.route('**/wiki.api.get_translations*', (route) => route.abort());

		await page.goto(APP_BASE);

		await expect(
			page.getByRole('link', { name: 'All Spaces', exact: true }),
		).toBeVisible();
	});
});
