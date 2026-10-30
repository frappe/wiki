import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { chromium, request } from 'playwright';

export const BASE_URL = process.env.BASE_URL || 'http://wiki.localhost:8000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const DEMO_DOMAIN = 'northstarlabs.example';

export const SPACES = {
	handbook: 'Company Handbook',
	raven: 'Raven',
	docs: 'Frappe Wiki Docs',
	engineering: 'Engineering Handbook',
};

const HIDE_CSS = `
	*, *::before, *::after { caret-color: transparent !important; scrollbar-width: none !important; }
	::-webkit-scrollbar { display: none !important; }
	[data-sonner-toaster], #alert-container, .desk-alert { display: none !important; }
`;

/** Generated space marks use random seeds; a fixed seed keeps them the same in both themes and every run. */
const SEEDED_RANDOM = `(() => {
	let state = 20261030;
	const next = () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
	Math.random = next;
	crypto.getRandomValues = (array) => {
		for (let index = 0; index < array.length; index++) array[index] = Math.floor(next() * 256);
		return array;
	};
})();`;

const BUSY = '.animate-spin, [aria-busy="true"]';

export function email(user) {
	if (user === 'admin') return 'Administrator';
	return user.includes('@') ? user : `${user}@${DEMO_DOMAIN}`;
}

function password(user) {
	if (user === 'admin') return ADMIN_PASSWORD;
	if (!DEMO_PASSWORD) throw new Error('Set DEMO_PASSWORD to the password of the demo users.');
	return DEMO_PASSWORD;
}

/** Frappe REST client for setup and cleanup, signed in as one user. */
export class Api {
	constructor(context) {
		this.context = context;
	}

	static async login(user = 'admin') {
		const context = await request.newContext({ baseURL: BASE_URL });
		const response = await context.post('/api/method/login', {
			form: { usr: email(user), pwd: password(user) },
		});
		if (!response.ok()) throw new Error(`Login failed for ${user}: ${response.status()}`);
		return new Api(context);
	}

	async send(method, path, options = {}) {
		const response = await this.context.fetch(path, { method, ...options });
		const body = await response.text();
		if (!response.ok()) {
			throw new Error(`${method} ${path} failed (${response.status()}): ${body.slice(0, 500)}`);
		}
		return body ? JSON.parse(body) : {};
	}

	async call(method, args = {}) {
		const { message } = await this.send('POST', `/api/method/${method}`, { data: args });
		return message;
	}

	async getList(doctype, { filters = {}, fields = ['name'], orderBy = 'creation desc' } = {}) {
		const params = {
			filters: JSON.stringify(filters),
			fields: JSON.stringify(fields),
			order_by: orderBy,
			limit_page_length: '0',
		};
		const { data } = await this.send('GET', `/api/resource/${encodeURIComponent(doctype)}`, { params });
		return data;
	}

	async getDoc(doctype, name) {
		const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
		const { data } = await this.send('GET', path);
		return data;
	}

	async setValues(doctype, name, values) {
		const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
		const { data } = await this.send('PUT', path, { data: values });
		return data;
	}

	async insert(doctype, values) {
		const { data } = await this.send('POST', `/api/resource/${encodeURIComponent(doctype)}`, {
			data: values,
		});
		return data;
	}

	async delete(doctype, name) {
		const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
		await this.send('DELETE', path);
	}

	async getValue(doctype, filters, field = 'name') {
		const rows = await this.getList(doctype, { filters, fields: [field] });
		return rows[0]?.[field];
	}

	async getSingleValue(doctype, field) {
		const params = { doctype, field };
		const { message } = await this.send('GET', '/api/method/frappe.client.get_single_value', { params });
		return message;
	}

	async spaceId(spaceName) {
		const id = await this.getValue('Wiki Space', { space_name: spaceName });
		if (!id) throw new Error(`Space "${spaceName}" not found. Load the demo data first.`);
		return id;
	}

	async pageId(route) {
		const id = await this.getValue('Wiki Document', { route });
		if (!id) throw new Error(`Page with route "${route}" not found. Load the demo data first.`);
		return id;
	}

	async changeRequestId(title) {
		const id = await this.getValue('Wiki Change Request', { title });
		if (!id) throw new Error(`Change request "${title}" not found. Load the demo data first.`);
		return id;
	}

	async dispose() {
		await this.context.dispose();
	}
}

/** One browser with a signed-in context per user, theme and viewport. */
export class Browser {
	constructor(browser, timezoneId) {
		this.browser = browser;
		this.timezoneId = timezoneId;
		this.contexts = new Map();
	}

	static async launch(timezoneId) {
		const browser = await chromium.launch({
			channel: 'chromium',
			executablePath: process.env.CHROMIUM_PATH,
			args: ['--font-render-hinting=none'],
		});
		return new Browser(browser, timezoneId);
	}

	async context(user, theme, viewport = { width: 1440, height: 900 }, scale = 2) {
		const key = `${user}:${theme}:${viewport.width}x${viewport.height}@${scale}`;
		if (!this.contexts.has(key)) this.contexts.set(key, await this.newContext(user, theme, viewport, scale));
		return this.contexts.get(key);
	}

	async newContext(user, theme, viewport, scale) {
		const isPhone = viewport.width < 600;
		const context = await this.browser.newContext({
			baseURL: BASE_URL,
			viewport,
			deviceScaleFactor: scale,
			colorScheme: theme,
			timezoneId: this.timezoneId,
			locale: 'en-US',
			isMobile: isPhone,
			hasTouch: isPhone,
		});
		await context.route('**/web_page_view.make_view_log', (route) => route.abort());
		await context.addInitScript(SEEDED_RANDOM);
		await context.addInitScript((value) => {
			localStorage.setItem('theme', value);
			indexedDB.deleteDatabase('wiki-drafts');
		}, theme);
		if (user !== 'guest') {
			const response = await context.request.post('/api/method/login', {
				form: { usr: email(user), pwd: password(user) },
			});
			if (!response.ok()) throw new Error(`Login failed for ${user}: ${response.status()}`);
		}
		return context;
	}

	async forgetUser(user) {
		for (const [key, context] of this.contexts) {
			if (!key.startsWith(`${user}:`)) continue;
			await context.close();
			this.contexts.delete(key);
		}
	}

	async close() {
		await this.browser.close();
	}
}

export async function waitStable(page) {
	await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
	await page.evaluate(async () => {
		const deadline = Date.now() + 8000;
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		await document.fonts.ready;
		while (Date.now() < deadline) {
			const running = document
				.getAnimations()
				.filter((animation) => animation.playState === 'running')
				.filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
			const loading = [...document.images].filter(
				(image) => !image.complete && image.loading !== 'lazy' && image.getBoundingClientRect().height > 0,
			);
			if (!running.length && !loading.length) return;
			await sleep(100);
		}
	});
	await page.waitForTimeout(300);
}

export async function waitIdle(page, busy = BUSY) {
	await page
		.locator(busy)
		.filter({ visible: true })
		.first()
		.waitFor({ state: 'detached', timeout: 15000 })
		.catch(() => {});
	await waitStable(page);
}

async function boxOf(target) {
	const box = await target.boundingBox();
	if (!box) throw new Error(`Crop target is not visible: ${target}`);
	return box;
}

/** Union of the bounding boxes of the crop targets, padded and kept inside the viewport. */
export async function cropBox(page, targets, padding) {
	const boxes = await Promise.all(targets.map(boxOf));
	const viewport = page.viewportSize();
	const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding);
	const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
	const right = Math.min(viewport.width, Math.max(...boxes.map((box) => box.x + box.width)) + padding);
	const bottom = Math.min(viewport.height, Math.max(...boxes.map((box) => box.y + box.height)) + padding);
	return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
}

export async function visibleBusyCount(page, clip) {
	return page.evaluate(
		({ selector, clip }) =>
			[...document.querySelectorAll(selector)].filter((element) => {
				const rect = element.getBoundingClientRect();
				if (!rect.width || getComputedStyle(element).visibility === 'hidden') return false;
				return (
					rect.right > clip.x &&
					rect.left < clip.x + clip.width &&
					rect.bottom > clip.y &&
					rect.top < clip.y + clip.height
				);
			}).length,
		{ selector: BUSY, clip },
	);
}

export async function screenshot(page, clip, path) {
	await page.evaluate(() => {
		for (const field of document.querySelectorAll('[contenteditable], textarea, input')) field.spellcheck = false;
	});
	await page.screenshot({ path, clip, style: HIDE_CSS, animations: 'disabled', caret: 'hide' });
}

export function toWebp(png, webp) {
	execFileSync('magick', [png, '-quality', '85', '-define', 'webp:method=6', webp]);
}

export function meanBrightness(png) {
	return Number(execFileSync('magick', [png, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:']).toString());
}

export async function retry(action, attempts = 20, delay = 1000) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await action();
		} catch (error) {
			if (attempt >= attempts) throw error;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

export async function spaceIds(api) {
	return {
		handbook: await api.spaceId(SPACES.handbook),
		raven: await api.spaceId(SPACES.raven),
	};
}

/** Box of the full-height column (a sidebar) that holds the element. */
export async function columnOf(locator) {
	return locator.evaluate((element) => {
		let node = element;
		while (node.parentElement && node.getBoundingClientRect().height < window.innerHeight - 1) {
			node = node.parentElement;
		}
		const rect = node.getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	});
}

export async function openReaderMenu(page) {
	const toggle = page.getByRole('button', { name: 'More page actions' });
	await toggle.click();
	const menu = toggle.locator('xpath=../..').locator(':scope > [x-show="open"]');
	await menu.waitFor();
	return menu;
}

export async function expandTreeGroup(page, name) {
	const item = page.getByRole('treeitem', { name: `Expand ${name}` });
	if (await item.count()) await item.getByRole('button', { name: 'Expand' }).click();
}

export const CHANGE_REQUEST_API = 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request';

export function dialog(page, name) {
	return page.getByRole('dialog', name ? { name } : {}).last();
}

export async function openSpaceSettings(page, tab) {
	await page.getByRole('button', { name: 'Space actions' }).click();
	await page.getByRole('menuitem', { name: 'Space settings' }).click();
	const settings = dialog(page, 'Settings');
	await settings.getByRole('tab', { name: tab }).click();
	await waitIdle(page);
	return settings;
}

export async function openWikiSettings(page, tab = 'General') {
	await page.getByRole('button', { name: /^Logo Frappe Wiki/ }).click();
	await page.getByRole('menuitem', { name: 'Settings' }).click();
	const settings = dialog(page, 'Settings');
	await settings.getByRole('tab', { name: tab }).click();
	await waitIdle(page);
	return settings;
}

/** The top of the space sidebar: header, mode strip and the first tree rows. */
export async function sidebarTop(page, rowsBelow = 3) {
	const column = await columnOf(page.getByRole('button', { name: 'Space actions' }));
	const rows = page.getByRole('treeitem');
	const last = await rows.nth(rowsBelow - 1).boundingBox();
	const bottom = last ? last.y + 36 : 200;
	return { x: column.x, y: 0, width: column.width, height: Math.ceil(bottom) };
}

export async function assign(api, changeRequest, user) {
	await api.call('frappe.desk.form.assign_to.add', {
		doctype: 'Wiki Change Request',
		name: changeRequest,
		assign_to: JSON.stringify([email(user)]),
	});
}

export async function unassign(api, changeRequest, user) {
	await api.call('frappe.desk.form.assign_to.remove', {
		doctype: 'Wiki Change Request',
		name: changeRequest,
		assign_to: email(user),
	});
}

export async function deleteSpace(api, spaceName) {
	const spaces = await api.getList('Wiki Space', { filters: { space_name: spaceName } });
	for (const { name } of spaces) await api.delete('Wiki Space', name);
}

export async function openReaderSearch(page, query) {
	await page.getByRole('button', { name: 'Open search' }).click();
	const modal = page.locator('[x-data="wikiSearch()"] .max-w-xl');
	const input = modal.locator('input');
	await input.waitFor();
	await page.waitForFunction((element) => document.activeElement === element, await input.elementHandle());
	await page.waitForTimeout(300);
	await input.fill(query);
	await modal.locator('[data-testid="search-result"]').first().waitFor();
	await waitStable(page);
	return modal;
}

/** Run the queued search indexing now, then wait until the reader search finds the query. */
export async function reindexSearch(api, reader, query, routePrefix) {
	const job = await api.getValue('Scheduled Job Type', { method: 'frappe.search.sqlite_search.index_docs_in_queue' });
	const search = 'wiki.frappe_wiki.doctype.wiki_document.search.search';
	await retry(async () => {
		await api.call('frappe.core.doctype.scheduled_job_type.scheduled_job_type.execute_event', {
			doc: JSON.stringify({ name: job }),
		});
		await new Promise((resolve) => setTimeout(resolve, 3000));
		const { message } = await reader.send('GET', `/api/method/${search}`, { params: { query } });
		const hits = message.results.filter((result) => result.route.startsWith(routePrefix));
		if (!hits.length) throw new Error(`Search index has no result for "${query}" in ${routePrefix}`);
	}, 20, 2000);
}

export async function waitSaved(page) {
	await page.getByTestId('sync-state-alert').waitFor({ state: 'hidden', timeout: 30000 });
	await waitIdle(page);
}

export async function openMarkPicker(page, tab) {
	await page.getByTestId('space-identity-trigger').first().click();
	const picker = dialog(page, 'Change space logo');
	await picker.getByRole('radio', { name: tab }).click();
	await waitStable(page);
	return picker;
}

/** Charts draw on a canvas after the data arrives, so let their intro animation end. */
export async function waitCharts(page) {
	await waitIdle(page);
	await page.waitForTimeout(2000);
}

export async function setDeskTheme(page, theme) {
	await page.evaluate((value) => {
		document.documentElement.setAttribute('data-theme', value);
		document.documentElement.setAttribute('data-theme-mode', value);
	}, theme);
}

export async function setViewTracking(api, enabled) {
	await api.call('frappe.client.set_value', {
		doctype: 'Website Settings',
		name: 'Website Settings',
		fieldname: 'enable_view_tracking',
		value: enabled ? 1 : 0,
	});
}

/** Scroll the nearest scroller so the element sits this far below its top. */
export async function scrollToTop(locator, offset = 80) {
	await locator.evaluate((element, gap) => {
		let scroller = element.parentElement;
		while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
			scroller = scroller.parentElement;
		}
		const top = element.getBoundingClientRect().top;
		if (scroller) scroller.scrollBy(0, top - scroller.getBoundingClientRect().top - gap);
		else window.scrollBy(0, top - gap);
	}, offset);
	await locator.page().waitForTimeout(300);
}

/** Open the page in edit mode. Starts a change request with this title when the user has no draft. */
export async function startEditing(page, title, description) {
	const toolbar = page.locator('.wiki-toolbar');
	const edit = page.getByRole('main').getByRole('button', { name: 'Edit', exact: true });
	await toolbar.or(edit).first().waitFor();
	if (await toolbar.isVisible()) return waitIdle(page);

	await edit.click();
	const newRequest = dialog(page, 'New change request');
	await toolbar.or(newRequest).first().waitFor();
	if (await newRequest.isVisible()) {
		await newRequest.getByLabel(/^Title/).fill(title);
		if (description) await newRequest.getByLabel('Description').fill(description);
		await newRequest.getByRole('button', { name: 'Start editing' }).click();
	}
	await toolbar.waitFor();
	await waitIdle(page);
}

/** Delete the open change requests a user started in a space, so the demo list stays as it was. */
export async function deleteDrafts(api, user, space, titles) {
	const drafts = await api.getList('Wiki Change Request', {
		filters: { owner: email(user), wiki_space: space, title: ['in', titles] },
	});
	for (const { name } of drafts) await deleteChangeRequest(api, name);
}

/** Delete a change request with its own revisions; the revisions and the request link to each other. */
export async function deleteChangeRequest(api, name) {
	const conflicts = await api.getList('Wiki Merge Conflict', { filters: { change_request: name } });
	for (const conflict of conflicts) await api.delete('Wiki Merge Conflict', conflict.name);

	const revisions = await api.getList('Wiki Revision', { filters: { change_request: name } });
	for (const revision of revisions) await api.setValues('Wiki Revision', revision.name, { change_request: null });
	await api.delete('Wiki Change Request', name);

	for (const revision of revisions) {
		const items = await api.getList('Wiki Revision Item', { filters: { revision: revision.name } });
		for (const item of items) await api.delete('Wiki Revision Item', item.name);
		await api.delete('Wiki Revision', revision.name);
	}
}

/** The last block before the next heading in the section under this heading. */
export async function endOfSection(page, heading) {
	const handle = await page.locator('.ProseMirror').getByRole('heading', { name: heading }).evaluateHandle((element) => {
		let node = element;
		while (node.nextElementSibling && !/^H[1-6]$/.test(node.nextElementSibling.tagName)) {
			node = node.nextElementSibling;
		}
		return node;
	});
	return handle.asElement();
}

/** Put the editor caret at the end of the block. */
export async function caretAtEnd(block) {
	await block.evaluate((element) => {
		element.closest('[contenteditable="true"]').focus();
		const range = document.createRange();
		range.selectNodeContents(element);
		range.collapse(false);
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await new Promise((resolve) => setTimeout(resolve, 200));
}

/** The content column right of the sidebar, from the top down to the bottom of the element. */
export async function mainDownTo(page, locator, padding = 24) {
	const column = await columnOf(page.getByRole('main'));
	const box = await locator.boundingBox();
	const height = Math.min(page.viewportSize().height, Math.ceil(box.y + box.height + padding));
	return { x: Math.floor(column.x), y: 0, width: Math.ceil(column.width), height };
}

/** Wait until a cloned space has as many documents as its source. */
export async function waitForClone(api, source, route, timeout = 180000) {
	const count = async (space) =>
		(await api.getList('Wiki Document', { filters: { wiki_space: space } })).length;
	const expected = await count(source);
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const space = await api.getValue('Wiki Space', { route });
		if (space && (await count(space)) >= expected) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			return space;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`The copy of the space at /${route} was not complete in time`);
}

/** Run a sync of a git-synced space and wait until it is done. */
export async function syncSpace(api, space, timeout = 180000) {
	const before = (await api.getList('Wiki Git Sync Log', { filters: { wiki_space: space } })).length;
	await api.call('run_doc_method', { dt: 'Wiki Space', dn: space, method: 'sync_now' });
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 3000));
		const logs = await api.getList('Wiki Git Sync Log', { filters: { wiki_space: space } });
		const status = await api.getValue('Wiki Space', { name: space }, 'last_sync_status');
		if (logs.length > before && !['Pending', 'Running'].includes(status)) return status;
	}
	throw new Error(`Sync of ${space} did not finish in time`);
}

const STAGE_WIDTH = 1000;
const STAGE_PADDING = 56;
const STAGE = {
	light: {
		background: 'radial-gradient(130% 120% at 0% 0%, #f5f4f2 0%, #ecebe8 55%, #e4e3df 100%)',
		shadow: '0 0 0 1px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04), 0 10px 28px -8px rgba(0,0,0,0.1), 0 28px 72px -16px rgba(0,0,0,0.16)',
		dim: 'rgba(255,255,255,0.55)',
	},
	dark: {
		background: 'radial-gradient(130% 120% at 0% 0%, #3b3b3f 0%, #303034 55%, #29292c 100%)',
		shadow: '0 0 0 1px rgba(255,255,255,0.10), 0 1px 2px rgba(0,0,0,0.3), 0 10px 28px -8px rgba(0,0,0,0.45), 0 28px 72px -16px rgba(0,0,0,0.55)',
		dim: 'rgba(0,0,0,0.45)',
	},
};
export const FRAMED_VIEWPORT = { width: 1280, height: 800 };
const HALF = { width: 640, height: 400, maxHeight: 400 };

/** Stage padding per side: crop edges on the viewport edge get padding, the others bleed. */
function paddingOf(crop, viewport) {
	return {
		left: crop.x <= 0 ? STAGE_PADDING : 0,
		top: crop.y <= 0 ? STAGE_PADDING : 0,
		right: crop.x + crop.width >= viewport.width ? STAGE_PADDING : 0,
		bottom: crop.y + crop.height >= viewport.height ? STAGE_PADDING : 0,
	};
}

/** About half the window around the target, on the side where the target is. A tall target is cut at maxHeight. */
export function halfCrop(target, viewport, margin, maxHeight = HALF.maxHeight) {
	const top = Math.max(0, target.y - margin);
	const bottom = Math.min(viewport.height, target.y + target.height + margin);

	let y = 0;
	let height = Math.max(HALF.height, bottom);
	if (bottom > maxHeight) {
		y = top < margin * 4 ? 0 : Math.min(top, viewport.height - HALF.height);
		height = Math.min(maxHeight, viewport.height - y, Math.max(HALF.height, bottom - y));
	}
	const width = Math.min(viewport.width, Math.max(HALF.width, Math.ceil(height * 1.25), target.width + margin * 2));
	height = Math.min(height, width);

	const isLeft = target.x + target.width / 2 < viewport.width / 2;
	const x = isLeft ? 0 : viewport.width - width;
	return { x, y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** True when a modal backdrop already dims the page. */
export async function hasBackdrop(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('body *')].some((element) => {
			const style = getComputedStyle(element);
			if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') return false;
			const rect = element.getBoundingClientRect();
			if (rect.width < window.innerWidth - 2 || rect.height < window.innerHeight - 2) return false;
			const alpha = style.backgroundColor.match(/rgba\(.*,\s*([\d.]+)\)/)?.[1];
			return alpha !== undefined && Number(alpha) > 0.05 && Number(alpha) < 0.95 && Number(style.opacity) > 0.5;
		}),
	);
}

/** Dim everything outside the box. Returns a function that removes the dim. */
export async function dimOutside(page, box, theme) {
	await page.evaluate(
		({ box, color }) => {
			const sides = [
				{ left: 0, top: 0, width: '100vw', height: `${box.y}px` },
				{ left: 0, top: `${box.y + box.height}px`, width: '100vw', bottom: 0 },
				{ left: 0, top: `${box.y}px`, width: `${box.x}px`, height: `${box.height}px` },
				{ left: `${box.x + box.width}px`, top: `${box.y}px`, right: 0, height: `${box.height}px` },
			];
			for (const side of sides) {
				const dim = document.createElement('div');
				dim.dataset.docsDim = '';
				Object.assign(dim.style, { position: 'fixed', background: color, zIndex: 2147483647, pointerEvents: 'none' }, side);
				document.body.append(dim);
			}
		},
		{ box, color: STAGE[theme].dim },
	);
	return () => page.evaluate(() => document.querySelectorAll('[data-docs-dim]').forEach((dim) => dim.remove()));
}

/** Put the crop of a full-viewport PNG on the stage as a rounded window and save it as WebP. */
export async function frame(browser, png, crop, viewport, theme, output) {
	const padding = paddingOf(crop, viewport);
	const scale = (STAGE_WIDTH - padding.left - padding.right) / crop.width;
	const stageHeight = Math.round(crop.height * scale + padding.top + padding.bottom);
	const left = padding.left - crop.x * scale;
	const top = padding.top - crop.y * scale;
	const { background, shadow } = STAGE[theme];
	const image = readFileSync(png).toString('base64');
	const html = `<!doctype html><html><head><style>
		html, body { margin: 0; }
		.stage { position: relative; overflow: hidden; width: ${STAGE_WIDTH}px; height: ${stageHeight}px; background: ${background}; }
		.window { position: absolute; left: ${left}px; top: ${top}px; width: ${viewport.width * scale}px; height: ${viewport.height * scale}px;
			border-radius: 12px; overflow: hidden; box-shadow: ${shadow}; }
		.window img { display: block; width: 100%; height: 100%; }
	</style></head><body><div class="stage"><div class="window"><img src="data:image/png;base64,${image}"></div></div></body></html>`;

	const context = await browser.newContext({ viewport: { width: STAGE_WIDTH, height: stageHeight }, deviceScaleFactor: 2 });
	const page = await context.newPage();
	await page.setContent(html);
	await page.locator('img').evaluate((element) => element.decode());
	const stagePng = `${png}.stage.png`;
	await page.locator('.stage').screenshot({ path: stagePng });
	await context.close();
	toWebp(stagePng, output);
	rmSync(stagePng);
}
