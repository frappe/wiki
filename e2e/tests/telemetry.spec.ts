import { expect, test } from '../fixtures';
import { appUrl } from '../helpers/routes';

const BOOT_CONFIG = '**/frappe.utils.telemetry.pulse.client.boot_config*';
const PULSE_CLIENT =
	'https://pulse.m.frappe.cloud/assets/pulse/js/pulse_client.js';

// The real client posts to Pulse, which no test should reach. Stub it with a
// module of the same shape that records what the app captures.
const STUB_CLIENT = `
export class PulseClient {
	constructor(options) {
		this.options = options;
		window.__pulse = { options, captures: [] };
	}
	async init() { return true; }
	setEnabled() {}
	capture(event_name, app, props) {
		window.__pulse.captures.push({ event_name, app, props });
	}
	getDistinctId() { return 'test'; }
	flush() {}
	stop() {}
}
`;

test.describe('Telemetry', () => {
	test.beforeEach(async ({ page }) => {
		await page.route(BOOT_CONFIG, (route) =>
			route.fulfill({
				json: {
					message: {
						enabled: true,
						host: 'https://pulse.m.frappe.cloud',
						key: 'test-key',
						site: 'wiki.test',
						site_age: 1,
					},
				},
			}),
		);
		await page.route(PULSE_CLIENT, (route) =>
			route.fulfill({
				body: STUB_CLIENT,
				contentType: 'application/javascript',
			}),
		);
	});

	test('sends a pageview for wiki, with the route pattern and no page title', async ({
		page,
		wiki,
	}) => {
		const token = `Quillfeather${Date.now().toString(36)}`;
		await wiki.space({
			space_name: `${token} Space`,
			pages: [{ title: `${token} Page` }],
		});

		await page.goto(appUrl());
		await expect
			.poll(() => page.evaluate(() => window.__pulse?.captures.length ?? 0))
			.toBeGreaterThan(0);

		const captures = await page.evaluate(() => window.__pulse.captures);
		const pageview = captures.find((c) => c.event_name === 'pageview');
		expect(pageview.app).toBe('wiki');
		expect(pageview.props.route).toMatch(/^\/[^ ]*$/);
		expect(JSON.stringify(captures)).not.toContain(token);
	});
});
