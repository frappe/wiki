import { test as teardown } from '@playwright/test';
import { E2E_ROUTE_PREFIX } from '../helpers/factory';
import { deleteDoc, getList } from '../helpers/frappe';

/**
 * Sweep spaces a killed or crashed run left behind.
 *
 * The factory destroys what it seeds, so this only ever has work to do when a
 * run died between seeding and teardown. Scoped to the `e2e-` route prefix, so
 * it cannot reach a real space.
 */
teardown('sweep leftover e2e spaces', async ({ request }) => {
	const leftovers = await getList<{ name: string; route: string }>(
		request,
		'Wiki Space',
		{
			fields: ['name', 'route'],
			filters: { route: ['like', `${E2E_ROUTE_PREFIX}-%`] },
			limit: 0,
		},
	).catch(() => []);

	for (const space of leftovers) {
		try {
			await deleteDoc(request, 'Wiki Space', space.name);
			console.log(`swept leftover space ${space.route}`);
		} catch (error) {
			console.warn(`failed to sweep ${space.route}:`, error);
		}
	}
});
