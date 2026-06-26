import { defineConfig, devices } from '@playwright/test';

// Auth state file path (added to .gitignore)
const authFile = 'e2e/.auth/user.json';

/**
 * Playwright configuration for Wiki E2E tests.
 *
 * Uses the recommended "setup project" pattern for authentication:
 * 1. Setup project runs first and saves auth state to file
 * 2. Other projects depend on setup and reuse the stored auth state
 *
 * @see https://playwright.dev/docs/auth
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
	testDir: './e2e/tests',
	fullyParallel: false, // Sequential for Frappe state consistency
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 1, // Single worker for Frappe session management
	// Use multiple reporters in CI for both inline annotations and HTML artifacts
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
	timeout: 60000, // 60s per test

	expect: {
		timeout: 10000, // 10s for assertions
	},

	use: {
		baseURL: process.env.BASE_URL || 'http://wiki.test:8000',
		trace: 'on-first-retry',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 15000,
		navigationTimeout: 30000,
	},

	projects: [
		// Setup project - authenticates and saves state
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/,
		},
		// Main test project - uses stored auth state
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				storageState: authFile,
			},
			// Mobile SPA specs run in the dedicated `mobile` project below.
			testIgnore: /\.mobile\.spec\.ts$/,
			dependencies: ['setup'],
		},
		// Mobile SPA project - phone viewport for the responsive app shell.
		// Pixel 7 keeps us on chromium (no extra webkit install) with touch +
		// isMobile. Scoped to *.mobile.spec.ts to keep the run lean (project
		// memory: e2e flooding the local job queue).
		{
			name: 'mobile',
			use: {
				...devices['Pixel 7'],
				storageState: authFile,
			},
			testMatch: /\.mobile\.spec\.ts$/,
			dependencies: ['setup'],
		},
	],
});
