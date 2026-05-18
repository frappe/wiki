const MERMAID_ASSET_URL = '/assets/wiki/js/vendor/mermaid/mermaid.min.js';

let mermaidPromise = null;

export function getMermaid() {
	if (window.mermaid) {
		return Promise.resolve(window.mermaid);
	}

	if (!mermaidPromise) {
		mermaidPromise = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = MERMAID_ASSET_URL;
			script.onload = () => resolve(window.mermaid);
			script.onerror = () => reject(new Error('Unable to load Mermaid asset'));
			document.head.appendChild(script);
		}).then((mermaid) => {
			if (!mermaid) {
				throw new Error('Mermaid asset did not expose window.mermaid');
			}
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
			});
			return mermaid;
		});
	}

	return mermaidPromise;
}
