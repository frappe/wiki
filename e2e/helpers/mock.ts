import { Page, Route } from '@playwright/test';

/**
 * Helpers to intercept Frappe whitelisted method calls in E2E tests.
 *
 * Frappe RPCs are POSTs to `/api/method/<dotted.path>`. These helpers wrap
 * `page.route()` so tests can simulate latency or backend failures against
 * a specific method without touching unrelated traffic.
 */

const matcherFor = (method: string) =>
	new RegExp(`/api/method/${method.replace(/\./g, '\\.')}(?:\\?|$)`);

/**
 * Delay a Frappe method's response by `delayMs` before letting it through.
 * Returns an `unroute` function to remove the interceptor.
 */
export async function delayMethod(
	page: Page,
	method: string,
	delayMs: number,
): Promise<() => Promise<void>> {
	const handler = async (route: Route) => {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.continue();
	};
	const matcher = matcherFor(method);
	await page.route(matcher, handler);
	return () => page.unroute(matcher, handler);
}

/**
 * Fail a Frappe method with a 500 response shaped like a Frappe server error.
 * Returns an `unroute` function to remove the interceptor.
 */
export async function failMethod(
	page: Page,
	method: string,
	errorMessage = 'Mocked failure',
): Promise<() => Promise<void>> {
	const handler = async (route: Route) => {
		await route.fulfill({
			status: 500,
			contentType: 'application/json',
			body: JSON.stringify({
				exc_type: 'ValidationError',
				exception: errorMessage,
				_server_messages: JSON.stringify([
					JSON.stringify({ message: errorMessage, indicator: 'red' }),
				]),
			}),
		});
	};
	const matcher = matcherFor(method);
	await page.route(matcher, handler);
	return () => page.unroute(matcher, handler);
}
