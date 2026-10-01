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

type Capture = {
	event_name: string;
	app: string;
	props: Record<string, string | number>;
};

const recorded = () =>
	(window as unknown as { __pulse?: { captures: Capture[] } }).__pulse
		?.captures ?? [];

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
			.poll(() => page.evaluate(recorded).then((c) => c.length))
			.toBeGreaterThan(0);

		const captures = await page.evaluate(recorded);
		const pageview = captures.find((c) => c.event_name === 'pageview');
		expect(pageview?.app).toBe('wiki');
		// The route pattern, never a title or a real page slug.
		expect(pageview?.props.route).toMatch(/^\/[^ ]*$/);
		// Sent through wiki's wrapper, so it carries what every event carries.
		expect(pageview?.props.app_version).toBeTruthy();
		expect(pageview?.props.entry).toBeTruthy();
		expect(JSON.stringify(captures)).not.toContain(token);
	});

	test('reports an unmatched route as a constant, never the raw path', async ({
		page,
	}) => {
		// The router has no catch-all, so this path matches no route.
		const token = `Quillfeather${Date.now().toString(36)}`;
		await page.goto(appUrl('spaces', token, token));

		await expect
			.poll(() =>
				page
					.evaluate(recorded)
					.then((c) => c.find((x) => x.event_name === 'pageview')),
			)
			.toMatchObject({ props: { route: 'unmatched' } });

		const captures = await page.evaluate(recorded);
		expect(JSON.stringify(captures)).not.toContain(token);
	});

	test('sends command_palette_opened with how it was opened', async ({
		page,
	}) => {
		await page.goto(appUrl());
		await expect
			.poll(() => page.evaluate(recorded).then((c) => c.length))
			.toBeGreaterThan(0);

		await page.keyboard.press('ControlOrMeta+k');
		await expect
			.poll(() =>
				page
					.evaluate(recorded)
					.then((c) =>
						c.find((x) => x.event_name === 'command_palette_opened'),
					),
			)
			.toMatchObject({ app: 'wiki', props: { trigger: 'shortcut' } });
	});

	test('sends space_identity_set once the picker closes on a choice', async ({
		page,
		wiki,
	}) => {
		const space = await wiki.space();

		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(space.url());
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Space actions' }).click();
		await page.getByRole('menuitem', { name: 'Space settings' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByTestId('space-identity-trigger').click();
		// Picking an icon is the choice that closes the popover, which is where
		// the event fires.
		await page.getByRole('option', { name: 'Knowledge', exact: true }).click();

		await expect
			.poll(() =>
				page
					.evaluate(recorded)
					.then((c) => c.find((x) => x.event_name === 'space_identity_set')),
			)
			.toMatchObject({ app: 'wiki', props: { kind: 'icon', rolls: 0 } });
	});
});
