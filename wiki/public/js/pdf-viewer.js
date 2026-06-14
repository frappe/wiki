/**
 * Public-side PDF embed hydration.
 *
 * Server-rendered `.wiki-pdf-embed` cards (see wiki/wiki/markdown.py) ship with a
 * filename, a download link, and an empty <canvas>. This script renders the
 * first-page thumbnail with PDF.js and opens a full-screen scroll/zoom viewer on
 * click — the vanilla counterpart to the editor's PdfBlockView / PdfViewerModal.
 *
 * Mirrors image-viewer.js: lazy, idempotent binding + a MutationObserver so cards
 * are re-hydrated after SPA navigation swaps #wiki-content.
 */
(function () {
	// Vendored as `.js` (not `.mjs`) on purpose: nginx in Frappe production has no
	// MIME mapping for `.mjs` and serves it as application/octet-stream, which the
	// browser refuses to execute as a module (strict MIME checking). `.js` is
	// reliably served as text/javascript, and dynamic import() keys off the MIME
	// type, not the extension, so these still load as ES modules.
	const PDFJS_SRC = '/assets/wiki/js/vendor/pdfjs/pdf.min.js';
	const WORKER_SRC = '/assets/wiki/js/vendor/pdfjs/pdf.worker.min.js';

	let pdfjsPromise = null;
	const docCache = new Map();

	function getPdfjs() {
		if (!pdfjsPromise) {
			pdfjsPromise = import(PDFJS_SRC).then((lib) => {
				lib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
				return lib;
			});
		}
		return pdfjsPromise;
	}

	function loadDoc(url) {
		if (docCache.has(url)) return docCache.get(url);
		const promise = getPdfjs().then((lib) => lib.getDocument(url).promise);
		docCache.set(url, promise);
		return promise;
	}

	/* ---------- Inline scrollable rendering (all pages) ---------- */

	async function renderInline(card) {
		const url = card.getAttribute('data-src');
		const scroll = card.querySelector('[data-role="scroll"]');
		const pagesEl = card.querySelector('[data-role="pages"]');
		if (!url || !scroll || scroll.dataset.rendered) return;
		scroll.dataset.rendered = 'true';

		try {
			const pdf = await loadDoc(url);
			if (pagesEl) {
				pagesEl.textContent = `${pdf.numPages} ${
					pdf.numPages === 1 ? 'page' : 'pages'
				}`;
			}

			const dpr = window.devicePixelRatio || 1;
			// Content-box width (clientWidth includes the 1rem padding on each side).
			const cssWidth = Math.max((scroll.clientWidth || 640) - 32, 240);

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({
					scale: (cssWidth * dpr) / base.width,
				});
				const canvas = document.createElement('canvas');
				canvas.className = 'wiki-pdf-page';
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				canvas.style.width = '100%';
				canvas.style.height = 'auto';
				scroll.appendChild(canvas);
				await page.render({
					canvasContext: canvas.getContext('2d'),
					viewport,
				}).promise;
			}
			card.classList.add('is-ready');
		} catch (err) {
			scroll.dataset.rendered = '';
			card.classList.add('is-unavailable');
			console.error('[wiki-pdf] inline render failed', err);
		}
	}

	/* ---------- Full-screen viewer ---------- */

	let modal = null;
	let modalDoc = null;
	let modalScale = 1.2;
	let modalUrl = null;
	let renderToken = 0;

	function ensureModal() {
		if (modal) return modal;
		modal = document.createElement('div');
		modal.className = 'wiki-pdf-modal';
		modal.innerHTML = `
			<div class="wiki-pdf-modal-toolbar">
				<span class="wiki-pdf-modal-name"></span>
				<div class="wiki-pdf-modal-actions">
					<button type="button" class="wiki-pdf-modal-btn" data-act="zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
					<span class="wiki-pdf-modal-zoom"></span>
					<button type="button" class="wiki-pdf-modal-btn" data-act="zoom-in" title="Zoom in" aria-label="Zoom in">&plus;</button>
					<a class="wiki-pdf-modal-btn" data-act="download" download target="_blank" rel="noopener" title="Download" aria-label="Download">&darr;</a>
					<button type="button" class="wiki-pdf-modal-btn" data-act="close" title="Close (Esc)" aria-label="Close">&times;</button>
				</div>
			</div>
			<div class="wiki-pdf-modal-scroll"></div>
		`;
		document.body.appendChild(modal);

		modal.addEventListener('click', (e) => {
			const act = e.target.closest('[data-act]')?.getAttribute('data-act');
			if (act === 'zoom-in') setScale(modalScale + 0.25);
			else if (act === 'zoom-out') setScale(modalScale - 0.25);
			else if (act === 'close') closeModal();
			else if (
				e.target === modal ||
				e.target.classList.contains('wiki-pdf-modal-scroll')
			) {
				closeModal();
			}
		});
		return modal;
	}

	function setScale(next) {
		modalScale = Math.min(Math.max(Math.round(next * 100) / 100, 0.5), 4);
		renderModalPages();
	}

	async function openModal(url, filename) {
		const m = ensureModal();
		modalUrl = url;
		modalScale = 1.2;
		m.querySelector('.wiki-pdf-modal-name').textContent = filename || 'PDF';
		m.querySelector('[data-act="download"]').href = url;
		m.classList.add('active');
		document.body.classList.add('wiki-pdf-modal-open');

		try {
			modalDoc = await loadDoc(url);
			await renderModalPages();
		} catch (err) {
			console.error('[wiki-pdf] viewer failed', err);
			m.querySelector('.wiki-pdf-modal-scroll').innerHTML =
				`<div class="wiki-pdf-modal-error">Unable to display this PDF. ` +
				`<a href="${url}" target="_blank" rel="noopener">Download instead</a>.</div>`;
		}
	}

	async function renderModalPages() {
		if (!modal || !modalDoc) return;
		const token = ++renderToken;
		const scroll = modal.querySelector('.wiki-pdf-modal-scroll');
		modal.querySelector('.wiki-pdf-modal-zoom').textContent = `${Math.round(
			modalScale * 100,
		)}%`;
		scroll.innerHTML = '';
		const dpr = window.devicePixelRatio || 1;

		for (let i = 1; i <= modalDoc.numPages; i++) {
			const page = await modalDoc.getPage(i);
			if (token !== renderToken) return; // a newer zoom/open superseded us
			const viewport = page.getViewport({ scale: modalScale });
			const canvas = document.createElement('canvas');
			canvas.className = 'wiki-pdf-modal-page';
			canvas.width = Math.floor(viewport.width * dpr);
			canvas.height = Math.floor(viewport.height * dpr);
			canvas.style.width = `${Math.floor(viewport.width)}px`;
			canvas.style.height = `${Math.floor(viewport.height)}px`;
			const ctx = canvas.getContext('2d');
			ctx.scale(dpr, dpr);
			scroll.appendChild(canvas);
			await page.render({ canvasContext: ctx, viewport }).promise;
			if (token !== renderToken) return;
		}
	}

	function closeModal() {
		if (!modal) return;
		renderToken++;
		modal.classList.remove('active');
		document.body.classList.remove('wiki-pdf-modal-open');
		modal.querySelector('.wiki-pdf-modal-scroll').innerHTML = '';
		modalDoc = null;
		modalUrl = null;
	}

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
			closeModal();
		}
	});

	/* ---------- Binding ---------- */

	let cardObserver = null;
	function getCardObserver() {
		if (cardObserver) return cardObserver;
		if (!('IntersectionObserver' in window)) return null;
		cardObserver = new IntersectionObserver(
			(entries, obs) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						obs.unobserve(entry.target);
						renderInline(entry.target);
					}
				});
			},
			{ rootMargin: '300px' },
		);
		return cardObserver;
	}

	function bindCard(card) {
		if (card.dataset.pdfBound) return;
		card.dataset.pdfBound = 'true';

		card.querySelector('[data-role="open"]')?.addEventListener('click', () =>
			openModal(card.getAttribute('data-src'), card.getAttribute('data-filename')),
		);

		const observer = getCardObserver();
		if (observer) observer.observe(card);
		else renderInline(card);
	}

	function bindAll() {
		document.querySelectorAll('.wiki-pdf-embed').forEach(bindCard);
	}

	bindAll();

	const content = document.getElementById('wiki-content');
	if (content) {
		new MutationObserver(bindAll).observe(content, {
			childList: true,
			subtree: true,
		});
	}
})();
