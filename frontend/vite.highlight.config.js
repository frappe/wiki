import path from 'node:path';
import { defineConfig } from 'vite';

// Standalone build for the public reader's syntax highlighter. Kept separate
// from vite.config.js because the frappe-ui plugin there owns the SPA's html
// input; this one just emits a self-contained IIFE that sets window.hljs.
// Output lands next to the other hand-written public scripts, loaded via a
// plain <script> in templates/wiki/layout.html.
export default defineConfig({
	build: {
		outDir: '../wiki/public/js',
		emptyOutDir: false,
		sourcemap: false,
		target: 'es2015',
		lib: {
			entry: path.resolve(__dirname, 'src/public/highlight.js'),
			formats: ['iife'],
			name: 'WikiHighlight',
			fileName: () => 'wiki-highlight.bundle.js',
		},
	},
});
