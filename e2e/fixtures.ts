import { type APIRequestContext, test as base } from '@playwright/test';
import { WikiFactory } from './helpers/factory';

const AUTH_FILE = 'e2e/.auth/user.json';

/**
 * `test` with wiki fixtures that clean up after themselves.
 *
 * Import this instead of `@playwright/test` in any spec that needs a space:
 *
 * ```ts
 * import { expect, test } from '../fixtures';
 *
 * test('…', async ({ page, wiki }) => {
 *   const space = await wiki.space({ pages: [{ title: 'Alpha' }] });
 *   await page.goto(space.url());
 * });
 * ```
 *
 * Teardown runs in the fixture's own epilogue, so there is no `afterAll` to
 * forget and a failing test cannot skip it.
 */
export const test = base.extend<
	{ wiki: WikiFactory },
	{ wikiSuite: WikiFactory }
>({
	// Per-test: seeded in the test, gone when it ends. The default.
	wiki: async ({ request }, use) => {
		const factory = new WikiFactory(request);
		try {
			await use(factory);
		} finally {
			await factory.destroyAll();
		}
	},

	// Per-worker, for a describe whose tests share one seed. It builds its own
	// API context: the built-in `request` fixture is test-scoped, and a worker
	// fixture may not depend on one — nor would it still be alive by the time
	// this epilogue runs.
	wikiSuite: [
		async ({ playwright }, use, workerInfo) => {
			const context: APIRequestContext = await playwright.request.newContext({
				baseURL: workerInfo.project.use.baseURL,
				storageState: AUTH_FILE,
			});
			const factory = new WikiFactory(context);
			try {
				await use(factory);
			} finally {
				await factory.destroyAll();
				await context.dispose();
			}
		},
		{ scope: 'worker' },
	],
});

export { expect } from '@playwright/test';
