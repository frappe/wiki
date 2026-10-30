#!/usr/bin/env node
/**
 * Take the user guide screenshots in light and dark mode.
 *
 * Usage: node scripts/docs-screenshots/capture.mjs [group | group/shot ...]
 * Output: docs/images/<group>/<shot>-<theme>.webp
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Api,
	Browser,
	cropBox,
	dimOutside,
	frame,
	hasBackdrop,
	halfCrop,
	FRAMED_VIEWPORT,
	meanBrightness,
	screenshot,
	toWebp,
	visibleBusyCount,
	waitStable,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, '../../docs/images');
const debugDir = join(tmpdir(), 'docs-screenshots-debug');
const THEMES = process.env.THEMES?.split(',') ?? ['light', 'dark'];

const problems = [];

function selection(args) {
	const groups = args.length
		? args
		: readdirSync(join(here, 'shots')).map((file) => file.replace(/\.mjs$/, ''));
	const wanted = new Map();
	for (const arg of groups) {
		const [group, shot] = arg.split('/');
		if (!wanted.has(group)) wanted.set(group, new Set());
		if (shot) wanted.get(group).add(shot);
	}
	return wanted;
}

async function pageFor(shot, run, previous) {
	if (shot.continue && previous) return previous;
	if (!shot.framed) await previous?.close();
	const context = shot.framed
		? await run.browser.context(shot.user, run.theme, shot.viewport ?? FRAMED_VIEWPORT, shot.scale ?? 3)
		: await run.browser.context(shot.user, run.theme, shot.viewport);
	const page = await context.newPage();
	page.on('pageerror', (error) => console.warn(`    page error: ${error.message}`));
	return page;
}

/** The crop target of the shot, or null for the whole window. */
async function targetOf(page, shot, run) {
	if (!shot.crop || shot.crop === 'window') return null;
	const target = await shot.crop(page, run);
	if ('width' in target && 'x' in target) return target;
	return cropBox(page, [target].flat(), shot.padding ?? 16);
}

/** A landscape region with the target at its real position and the rest dimmed. */
async function screenshotFramed(page, shot, run, target, png) {
	const viewport = page.viewportSize();
	const crop = halfCrop(target, viewport, 24, shot.cropHeight);
	const undim = (await hasBackdrop(page)) ? null : await dimOutside(page, target, run.theme);
	await screenshot(page, { x: 0, y: 0, ...viewport }, png);
	await undim?.();
	return { crop, viewport };
}

async function check(page, shot, png, clip, run, label) {
	const theme = await page.evaluate(() => document.documentElement.dataset.theme);
	if (theme !== run.theme) problems.push(`${label}: data-theme is "${theme}"`);

	const busy = await visibleBusyCount(page, clip);
	if (busy) problems.push(`${label}: ${busy} loading indicator(s) in the shot`);

	if (shot.isMostlyContent) return;
	const brightness = meanBrightness(png);
	const isDark = brightness < 0.5;
	if (isDark !== (run.theme === 'dark')) {
		problems.push(`${label}: mean brightness ${brightness.toFixed(2)} does not match the theme`);
	}
}

async function capture(page, shot, run, group) {
	const label = `${group}/${shot.name}-${run.theme}`;
	const url = typeof shot.url === 'function' ? shot.url(run) : shot.url;
	if (url) await page.goto(url);
	await waitStable(page);
	await shot.steps?.(page, run);
	await waitStable(page);

	const target = await targetOf(page, shot, run);
	await page.evaluate(() => document.fonts.ready);
	const png = join(tmpdir(), `docs-shot-${process.pid}.png`);
	const output = join(imagesDir, group, `${shot.name}-${run.theme}.webp`);
	mkdirSync(dirname(output), { recursive: true });

	if (shot.framed) {
		const { crop, viewport } = await screenshotFramed(page, shot, run, target, png);
		await check(page, shot, png, crop, run, label);
		await frame(run.browser.browser, png, crop, viewport, run.theme, output);
	} else {
		const clip = target ?? { x: 0, y: 0, ...page.viewportSize() };
		await screenshot(page, clip, png);
		await check(page, shot, png, clip, run, label);
		toWebp(png, output);
	}
	rmSync(png);
	console.log(`  ok ${label}`);
}

async function saveDebug(page, label) {
	mkdirSync(debugDir, { recursive: true });
	await page?.screenshot({ path: join(debugDir, `${label.replace('/', '--')}.png`) }).catch(() => {});
}

async function runShot(shot, run, group, previous) {
	const page = await pageFor(shot, run, previous);
	const label = `${group}/${shot.name}-${run.theme}`;
	try {
		await shot.setup?.(run);
		await capture(page, shot, run, group);
	} catch (error) {
		problems.push(`${label}: FAILED ${error.message.split('\n')[0]}`);
		console.error(`  FAILED ${label}\n${error.stack}`);
		await saveDebug(page, label);
	} finally {
		await shot.teardown?.(run, page);
	}
	if (!shot.framed) return page;
	await page.close();
	return previous;
}

async function runGroup(group, only, browser, api) {
	const module = await import(join(here, 'shots', `${group}.mjs`));
	const shots = module.shots.filter((shot) => !only.size || only.has(shot.name));

	for (const theme of THEMES) {
		const run = { api, browser, theme, state: {} };
		let page;
		try {
			await module.setup?.(run);
			for (const shot of shots) page = await runShot(shot, run, group, page);
		} catch (error) {
			problems.push(`${group} (${theme}): setup FAILED ${error.message.split('\n')[0]}`);
			console.error(error.stack);
		} finally {
			await page?.close();
			await module.teardown?.(run);
		}
	}
}

async function main() {
	const api = await Api.login('admin');
	const browser = await Browser.launch(await api.getSingleValue('System Settings', 'time_zone'));
	try {
		for (const [group, only] of selection(process.argv.slice(2))) {
			console.log(group);
			await runGroup(group, only, browser, api);
		}
	} finally {
		await browser.close();
		await api.dispose();
	}

	if (problems.length) {
		console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
		process.exitCode = 1;
	}
}

await main();
