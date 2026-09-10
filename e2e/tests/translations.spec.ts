import { expect, test } from '../fixtures';
import { APP_BASE } from '../helpers/routes';

const TRANSLATIONS_URL = '**/api/method/wiki.api.get_translations';

test.describe('Translations', () => {
	test('loads translations before the first render', async ({ page }) => {
		await page.route(TRANSLATIONS_URL, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 500));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					message: {
						Settings: 'Configuración de prueba',
						Spaces: 'Espacios de prueba',
						'Change Requests': 'Solicitudes de prueba',
						'Toggle Theme': 'Cambiar tema de prueba',
						'Log out': 'Salir de prueba',
					},
				}),
			});
		});

		const translationsLoaded = page.waitForResponse(TRANSLATIONS_URL);
		await page.goto(APP_BASE);
		await translationsLoaded;

		await expect(
			page.getByRole('link', { name: 'Espacios de prueba', exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole('link', {
				name: 'Solicitudes de prueba',
				exact: true,
			}),
		).toBeVisible();

		await page
			.getByRole('button', { name: /Frappe Wiki/ })
			.first()
			.click();
		await expect(
			page.getByText('Configuración de prueba', { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText('Cambiar tema de prueba', { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText('Salir de prueba', { exact: true }),
		).toBeVisible();
	});

	test('falls back to source strings when translations fail', async ({
		page,
	}) => {
		await page.route(TRANSLATIONS_URL, (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ exc_type: 'TranslationError' }),
			}),
		);

		await page.goto(APP_BASE);

		await expect(
			page.getByRole('link', { name: 'Spaces', exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole('link', { name: 'Change Requests', exact: true }),
		).toBeVisible();
	});
});
