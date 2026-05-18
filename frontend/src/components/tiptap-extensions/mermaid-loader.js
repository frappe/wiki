const MERMAID_ASSET_URL = '/assets/wiki/js/vendor/mermaid/mermaid.min.js';
const MERMAID_LOADER_URL = '/assets/wiki/js/mermaid-loader.js';

let loaderPromise = null;

function loadSharedMermaidLoader() {
	if (window.wikiGetMermaid) {
		return Promise.resolve(window.wikiGetMermaid);
	}
	if (!loaderPromise) {
		loaderPromise = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = MERMAID_LOADER_URL;
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
	return wikiGetMermaid({ assetUrl: MERMAID_ASSET_URL });
}
