import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.js: its frappe-ui plugins need the linked framework checkout, which CI installs without.
export default defineConfig({
	resolve: {
		alias: { '@': path.resolve(__dirname, 'src') },
	},
	test: {
		include: ['src/**/*.test.js'],
		restoreMocks: true,
	},
});
