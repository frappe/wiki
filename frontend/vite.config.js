import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Conditionally import frappe-ui plugin
async function getFrappeUIPlugin(isDev) {
	if (isDev) {
		try {
			const module = await import('./frappe-ui/vite');
			return module.default;
		} catch (error) {
			console.warn(
				'Local frappe-ui not found, falling back to npm package:',
				error.message,
			);
			// Fall back to npm package if local import fails
			const module = await import('frappe-ui/vite');
			return module.default;
		}
	}
	const module = await import('frappe-ui/vite');
	return module.default;
}

// https://vitejs.dev/config/
export default defineConfig(async ({ command, mode }) => {
	const isDev = process.env.NODE_ENV !== 'production';
	const frappeui = await getFrappeUIPlugin(isDev);

	const config = {
		plugins: [
			frappeui({
				frappeProxy: {
					port: 8080,
					source: '^/(app|login|api|assets|files|private|razorpay_checkout)',
				},
				jinjaBootData: true,
				lucideIcons: true,
				buildConfig: {
					indexHtmlPath: '../wiki/www/frontend.html',
					emptyOutDir: true,
					sourcemap: true,
				},
			}),
			vue(),
		],
		build: {
			chunkSizeWarningLimit: 1500,
			outDir: '../wiki/public/frontend',
			emptyOutDir: true,
			target: 'es2015',
			sourcemap: true,
		},
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src'),
				'tailwind.config.js': path.resolve(__dirname, 'tailwind.config.js'),
			},
		},
		optimizeDeps: {
			include: [
				'feather-icons',
				'showdown',
				'highlight.js/lib/core',
				'interactjs',
			],
		},
		server: {
			allowedHosts: true,
		},
	};

	// Add local frappe-ui alias only in development if the local frappe-ui exists
	if (isDev) {
		try {
			// Check if the local frappe-ui directory exists
			const fs = await import('node:fs');
			const localFrappeUIPath = path.resolve(__dirname, 'frappe-ui');
			if (fs.existsSync(localFrappeUIPath)) {
				config.resolve.alias['frappe-ui'] = localFrappeUIPath;
			} else {
				console.warn('Local frappe-ui directory not found, using npm package');
			}
		} catch (error) {
			console.warn(
				'Error checking for local frappe-ui, using npm package:',
				error.message,
			);
		}
	}

	return config;
});
