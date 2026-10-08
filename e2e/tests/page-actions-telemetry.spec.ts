import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import type { WikiFactory } from '../helpers/factory';

const PULSE_CLIENT_URL = 'https://pulse.test/assets/pulse/js/pulse_client.js';

// Stands in for Pulse's CDN client so CI needs no network and can read back
// what the reader passed to it.
const STUB_CLIENT = `
export class PulseClient {
	constructor(options) {
		window.pulseOptions = options;
		window.pulseEvents = [];
	}
	capture(event, app, props) {
		window.pulseEvents.push({ event, app, props });
	}
}
`;

declare global {
	interface Window {
		pulseOptions?: Record<string, unknown>;
		pulseEvents?: {
			event: string;
			app: string;
			props: Record<string, unknown>;
		}[];
	}
}

async function openReader(page: Page, wiki: WikiFactory, telemetry: object) {
	const space = await wiki.space({ pages: [{ title: 'Telemetry Page' }] });
	const route = space.page('Telemetry Page').route;

	await page.route(`**/${route}`, async (request) => {
		const response = await request.fetch();
		const html = await response.text();
		const rewritten = html.replace(
			/const readerTelemetry = .*?;\n/,
			`const readerTelemetry = ${JSON.stringify(telemetry)};\n`,
		);
		expect(rewritten).not.toBe(html);
		await request.fulfill({
			status: response.status(),
			contentType: 'text/html; charset=utf-8',
			body: rewritten,
		});
	});
	await page.route(PULSE_CLIENT_URL, (request) =>
		request.fulfill({
			contentType: 'text/javascript',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: STUB_CLIENT,
		}),
	);
	await page.route(
		'**/api/method/wiki.frappe_wiki.doctype.wiki_document.wiki_document.download_pdf?*',
		(request) =>
			request.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4' }),
	);

	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto(`/${route}`);
	await expect(page.locator('#wiki-page-title')).toBeVisible();

	// Keep the Ask AI links from leaving for chatgpt.com / claude.ai.
	await page.evaluate(() => {
		document.addEventListener(
			'click',
			(event) => {
				const anchor = (event.target as HTMLElement)?.closest?.(
					'a[target="_blank"]',
				);
				if (anchor) event.preventDefault();
			},
			true,
		);
	});
}

async function pickPageAction(
	page: Page,
	{ text, closesMenu }: (typeof ACTIONS)[number],
) {
	// The desktop menu beside the title; the mobile copy above it is hidden by CSS.
	const menu = page.locator('#wiki-page-title + div');
	const toggle = menu.getByRole('button', { name: 'More page actions' });
	if ((await toggle.getAttribute('aria-expanded')) !== 'true')
		await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await menu.locator('a, button').filter({ hasText: text }).click();
	// Download closes the menu only once the PDF arrives, so wait it out.
	await expect(toggle).toHaveAttribute('aria-expanded', String(!closesMenu));
}

const ACTIONS = [
	{ text: 'Download', action: 'download', closesMenu: true },
	{ text: 'Copy page', action: 'copy', closesMenu: true },
	{ text: 'Open in ChatGPT', action: 'chatgpt', closesMenu: false },
	{ text: 'Open in Claude', action: 'claude', closesMenu: false },
];

test.describe('Page actions telemetry', () => {
	test('each menu item reports page_action_used through the Pulse client', async ({
		page,
		wiki,
	}) => {
		await openReader(page, wiki, {
			enabled: true,
			client_url: PULSE_CLIENT_URL,
			host: 'https://pulse.test',
			key: 'test-key',
			site: 'wiki.test',
			user: null,
			team: 'team-test',
			app_version: '9.9.9',
		});

		for (const item of ACTIONS) {
			await pickPageAction(page, item);
			await expect
				.poll(() =>
					page.evaluate(() => window.pulseEvents?.at(-1)?.props.action),
				)
				.toBe(item.action);
		}

		const events = await page.evaluate(() => window.pulseEvents);
		expect(events).toEqual(
			ACTIONS.map(({ action }) => ({
				event: 'page_action_used',
				app: 'wiki',
				props: { action, app_version: '9.9.9' },
			})),
		);
		expect(await page.evaluate(() => window.pulseOptions)).toEqual({
			host: 'https://pulse.test',
			apiKey: 'test-key',
			site: 'wiki.test',
			user: null,
			team: 'team-test',
			enabled: true,
		});
	});

	test('loads no Pulse client when telemetry is off', async ({
		page,
		wiki,
	}) => {
		await openReader(page, wiki, { enabled: false });
		const scriptRequests: string[] = [];
		page.on('request', (request) => {
			if (request.resourceType() === 'script')
				scriptRequests.push(request.url());
		});

		for (const item of ACTIONS) {
			await pickPageAction(page, item);
		}
		await page.waitForTimeout(500);

		expect(scriptRequests).toEqual([]);
		expect(await page.evaluate(() => window.pulseEvents)).toBeUndefined();
	});
});
