const MERMAID_LOADER_PATH = '/assets/wiki/js/mermaid-loader.js';

let loaderPromise = null;

// `/assets` is served with far-future `immutable` caching, so requesting the
// bare path pins whichever copy the browser fetched first — a pre-fix loader
// keeps throwing for up to a year after the fix ships. The published reader
// versions its own <script> tag server-side (layout.html); do the same here
// with the hash the server puts on boot.
export function getLoaderUrl() {
	const hash = window.asset_hashes?.mermaid_loader;
	return hash ? `${MERMAID_LOADER_PATH}?v=${hash}` : MERMAID_LOADER_PATH;
}

function loadSharedMermaidLoader() {
	if (window.wikiGetMermaid) {
		return Promise.resolve(window.wikiGetMermaid);
	}
	if (!loaderPromise) {
		loaderPromise = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = getLoaderUrl();
			script.onload = () => resolve(window.wikiGetMermaid);
			script.onerror = () =>
				reject(new Error('Unable to load Mermaid loader asset'));
			document.head.appendChild(script);
		}).then((wikiGetMermaid) => {
			if (!wikiGetMermaid) {
				throw new Error('Mermaid loader did not expose window.wikiGetMermaid');
			}
			return wikiGetMermaid;
		});
	}

	return loaderPromise;
}

export async function getMermaid() {
	const wikiGetMermaid = await loadSharedMermaidLoader();
	// No assetUrl override: the shared loader owns the Mermaid vendor URL, and
	// versions it so a library bump isn't masked by the same immutable cache.
	return wikiGetMermaid();
}

// Mermaid theme config derived from the live Frappe UI tokens (defined in the
// shared loader asset). Ensures the editor preview matches the published page.
export async function getMermaidThemeConfig() {
	await loadSharedMermaidLoader();
	return window.wikiMermaidThemeConfig();
}
