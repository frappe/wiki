/**
 * Frappe Wiki service worker.
 *
 * Strategy (v1):
 *  - App shell (CSS/JS/fonts) precached on install.
 *  - Wiki pages cached on demand when the user taps "Make available offline"
 *    for a space. Each space gets its own cache: `wiki-space-<route>-v<n>`.
 *  - Fetch handler: cache-first for any URL we've stored, network-first for
 *    everything else, navigation fallback to /offline when both fail.
 *  - POST requests (e.g. the SPA's get_page_data) are never intercepted.
 *    When offline, the page's existing try/catch falls through to
 *    `window.location.href`, which then hits this SW's HTML cache.
 */

const SHELL_CACHE = 'wiki-shell-v1';
const SPACE_CACHE_PREFIX = 'wiki-space-';

const SHELL_ASSETS = ['/offline'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) => cache.addAll(SHELL_ASSETS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k === 'wiki-shell-v0')
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;

	// Only handle GETs. POSTs (get_page_data, form submits) pass through so the
	// page's own error handling kicks in when offline.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Same-origin only — don't interfere with third-party assets.
	if (url.origin !== self.location.origin) return;

	// Never cache API endpoints — too dynamic.
	if (url.pathname.startsWith('/api/')) return;

	event.respondWith(handleFetch(request));
});

async function handleFetch(request) {
	const cacheMatch = await caches.match(request, { ignoreSearch: false });
	if (cacheMatch) return cacheMatch;

	try {
		return await fetch(request);
	} catch (err) {
		// Network failed and we have no cached copy.
		if (request.mode === 'navigate') {
			const offline = await caches.match('/offline');
			if (offline) return offline;
		}
		throw err;
	}
}

self.addEventListener('message', (event) => {
	const data = event.data || {};
	if (data.type === 'PRECACHE_SPACE') {
		event.waitUntil(precacheSpace(data.manifest, event.source));
	} else if (data.type === 'REMOVE_SPACE') {
		event.waitUntil(removeSpace(data.spaceRoute));
	} else if (data.type === 'LIST_SPACES') {
		event.waitUntil(
			listSpaces().then((spaces) => {
				event.source?.postMessage({ type: 'SPACES_LIST', spaces });
			}),
		);
	}
});

/**
 * Download every page + image + shared asset for a space into a dedicated
 * cache. Reports progress back to the calling client.
 */
async function precacheSpace(manifest, client) {
	const spaceRoute = manifest.space.route;
	const cacheName = `${SPACE_CACHE_PREFIX}${spaceRoute}-v1`;

	// Drop any older copy of this space so leftover URLs don't linger.
	const existing = await caches.keys();
	await Promise.all(
		existing
			.filter(
				(k) =>
					k.startsWith(`${SPACE_CACHE_PREFIX}${spaceRoute}-`) &&
					k !== cacheName,
			)
			.map((k) => caches.delete(k)),
	);

	const cache = await caches.open(cacheName);

	// Build the URL list: shared assets + page HTMLs + embedded images.
	const urls = new Set();
	for (const u of manifest.shared_assets || []) urls.add(u);
	for (const page of manifest.pages) {
		urls.add(`/${page.route}`);
		for (const img of page.images || []) urls.add(img);
	}

	const allUrls = Array.from(urls);
	let done = 0;
	const failed = [];

	// Fetch one at a time so we can report progress and don't hammer the server.
	for (const url of allUrls) {
		try {
			const res = await fetch(url, {
				credentials: 'same-origin',
				redirect: 'follow',
			});
			if (res.ok || res.type === 'opaqueredirect') {
				await cache.put(url, res.clone());
			} else {
				failed.push({ url, status: res.status });
			}
		} catch (err) {
			failed.push({ url, error: String(err) });
		}
		done++;
		if (client) {
			client.postMessage({
				type: 'PRECACHE_PROGRESS',
				spaceRoute,
				done,
				total: allUrls.length,
			});
		}
	}

	// Persist the manifest itself so we can detect updates later.
	await cache.put(
		`__manifest__/${spaceRoute}`,
		new Response(JSON.stringify(manifest), {
			headers: { 'Content-Type': 'application/json' },
		}),
	);

	if (client) {
		client.postMessage({
			type: 'PRECACHE_DONE',
			spaceRoute,
			version: manifest.version,
			failed,
		});
	}
}

async function removeSpace(spaceRoute) {
	const keys = await caches.keys();
	await Promise.all(
		keys
			.filter((k) => k.startsWith(`${SPACE_CACHE_PREFIX}${spaceRoute}-`))
			.map((k) => caches.delete(k)),
	);
}

/**
 * Returns the cached manifest for each space currently stored offline.
 * The page UI uses this to render "downloaded / update available" state.
 */
async function listSpaces() {
	const keys = await caches.keys();
	const spaceCaches = keys.filter((k) => k.startsWith(SPACE_CACHE_PREFIX));
	const out = [];
	for (const name of spaceCaches) {
		const cache = await caches.open(name);
		// Find the manifest inside this cache.
		const requests = await cache.keys();
		const manifestReq = requests.find((r) => r.url.includes('/__manifest__/'));
		if (!manifestReq) continue;
		const res = await cache.match(manifestReq);
		if (!res) continue;
		out.push(await res.json());
	}
	return out;
}
