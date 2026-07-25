import { test } from '@playwright/test';
const S =
	'/private/tmp/claude-501/-Users-mdhussain-Frappe-benches-december-bench-apps-wiki/6c1eb0ce-6e13-431b-8dd4-356c0880fd19/scratchpad';

test('reader full', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/erpnext-docs/accounting/receivables/sales-invoice');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1000);
	await page.screenshot({ path: `${S}/10-reader-full.png` });
	await page.screenshot({
		path: `${S}/11-reader-tabs.png`,
		clip: { x: 0, y: 0, width: 1440, height: 110 },
	});
});

test('editor full', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/wiki/spaces/6s3ud3f6t7');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(2500);
	await page.screenshot({ path: `${S}/20-editor-full.png` });
	await page.screenshot({
		path: `${S}/21-editor-chrome.png`,
		clip: { x: 0, y: 0, width: 1440, height: 160 },
	});
});
