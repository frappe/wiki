import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	Api,
	CHANGE_REQUEST_API,
	SPACES,
	deleteSpace,
	dialog,
	openReaderSearch,
	openSpaceSettings,
	reindexSearch,
	sidebarTop,
	waitIdle,
	waitSaved,
} from '../lib.mjs';

const diagramSvg = join(dirname(fileURLToPath(import.meta.url)), '../assets/deploy-pipeline.svg');
const diagram = join(tmpdir(), 'deploy-pipeline.png');

async function cleanUp({ api }) {
	await deleteSpace(api, SPACES.engineering);
	const files = await api.getList('File', { filters: { file_name: ['like', 'deploy-pipeline%'] } });
	for (const { name } of files) await api.delete('File', name);
}

export async function setup(run) {
	execFileSync('magick', ['-density', '144', diagramSvg, diagram], { stdio: 'ignore' });
	await cleanUp(run);
}

export const teardown = cleanUp;

async function addRole(settings, role, level) {
	await settings.getByRole('combobox', { name: 'Search role to add' }).fill(role);
	await settings.page().getByRole('option', { name: role, exact: true }).click();
	await settings.getByRole('button', { name: 'Add', exact: true }).click();
	if (level === 'Read') return;
	await settings.getByRole('row', { name: role }).getByRole('combobox').click();
	await settings.page().getByRole('option', { name: level }).click();
}

async function typeInEditor(page) {
	const editor = page.locator('.ProseMirror[contenteditable="true"]');
	await editor.click();
	await page.keyboard.type('We deploy from the main branch every weekday at 10:00 UTC. Each deploy goes to staging first.');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.type('/');
	await page.getByText('Warning', { exact: true }).click();
	await page.keyboard.type('Do not deploy on Fridays.');

	await editor.locator(':scope > p').last().click();
	await page.keyboard.type('/');
	const chooser = page.waitForEvent('filechooser');
	await page.getByText('Image', { exact: true }).first().click();
	await (await chooser).setFiles(diagram);
	await editor.locator('img').first().waitFor();

	await editor.locator(':scope > p').first().click();
	await page.keyboard.press('End');
	await waitSaved(page);
}

export const shots = [
	{
		name: 'create-space-dialog',
		user: 'grace',
		url: '/wiki-app/spaces',
		async steps(page) {
			await page.getByRole('button', { name: 'New Space' }).click();
			await page.getByRole('textbox', { name: 'Space Name' }).fill(SPACES.engineering);
			await page.getByRole('textbox', { name: /^Route/ }).fill('engineering');
		},
		crop: (page) => dialog(page),
	},
	{
		name: 'space-access',
		user: 'grace',
		continue: true,
		async steps(page, run) {
			await dialog(page).getByRole('button', { name: 'Create' }).click();
			await page.waitForURL(/\/wiki-app\/spaces\/\w+/);
			run.state.spaceId = page.url().match(/spaces\/(\w+)/)[1];
			await waitIdle(page);
			const settings = await openSpaceSettings(page, 'Access');
			const guest = settings.getByRole('row', { name: 'Guest' });
			await guest.hover();
			await guest.getByRole('button').last().click();
			await addRole(settings, 'Employee', 'Read');
			await addRole(settings, 'Wiki Approver', 'Write');
			await settings.getByRole('button', { name: 'Save' }).click();
			await waitIdle(page);
		},
		crop: (page) => dialog(page, 'Settings'),
	},
	{
		name: 'create-page-dialog',
		user: 'grace',
		continue: true,
		async steps(page) {
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: 'New page' }).first().click();
			await dialog(page).getByLabel('Title').fill('How we deploy');
		},
		crop: (page) => dialog(page),
	},
	{
		name: 'page-in-editor',
		user: 'grace',
		continue: true,
		async steps(page) {
			await dialog(page).getByRole('button', { name: 'Save' }).click();
			await page.waitForURL(/\/(page|draft)\//);
			await waitIdle(page);
			await typeInEditor(page);
			await page.mouse.move(720, 890);
		},
	},
	{
		name: 'draft-strip',
		framed: true,
		user: 'grace',
		url: ({ state }) => `/wiki-app/spaces/${state.spaceId}`,
		async crop(page) {
			await page.locator('.contribution-strip').waitFor();
			return sidebarTop(page, 1);
		},
	},
	{
		name: 'change-request-details',
		user: 'grace',
		continue: true,
		async steps(page) {
			await page.getByRole('button', { name: 'Add initial content' }).click();
			const details = dialog(page, 'Change request');
			await details.getByLabel('Title').fill('Add the deploy guide');
			await details.getByLabel('Description').fill('First version of our deploy steps. Please check the Friday rule.');
		},
		crop: (page) => dialog(page),
	},
	{
		name: 'submit-dialog',
		user: 'grace',
		continue: true,
		async steps(page) {
			await dialog(page).getByRole('button', { name: 'Save' }).click();
			await dialog(page).waitFor({ state: 'hidden' });
			await page.getByRole('main').getByRole('button', { name: 'Submit for review' }).click();
		},
		crop: (page) => dialog(page),
	},
	{
		name: 'assign-reviewer',
		user: 'grace',
		continue: true,
		async steps(page, run) {
			await dialog(page).getByRole('button', { name: 'Submit' }).click();
			await page.waitForURL(/change-requests\/\w+/);
			run.state.changeRequest = page.url().match(/change-requests\/(\w+)/)[1];
			await waitIdle(page);
			await page.getByRole('button', { name: 'More actions' }).click();
			await page.getByRole('menuitem', { name: 'Assign reviewer' }).click();
			const assign = dialog(page, 'Assign Reviewer');
			await assign.getByText('Search people...').click();
			await page.keyboard.type('Priya', { delay: 30 });
			await page.getByRole('option', { name: /Priya Raman/ }).click();
			await dialog(page).getByRole('heading', { name: 'Assign Reviewer' }).click();
		},
		crop: (page) => dialog(page),
		async teardown(run, page) {
			await dialog(page).getByRole('button', { name: 'Assign', exact: true }).click();
			await dialog(page).waitFor({ state: 'hidden' });
		},
	},
	{
		name: 'assigned-to-me',
		user: 'priya',
		url: '/wiki-app/change-requests',
		async steps(page) {
			await page.getByRole('tab', { name: 'Assigned to me' }).click();
			await page.getByText('Add the deploy guide').waitFor();
		},
	},
	{
		name: 'review-page',
		user: 'priya',
		continue: true,
		async steps(page) {
			await page.getByText('Add the deploy guide').click();
			await page.waitForURL(/change-requests\/\w+/);
			await page.getByText('How we deploy').first().waitFor();
			await waitIdle(page);
		},
	},
	{
		name: 'live-page',
		user: 'kenji',
		url: '/engineering/how-we-deploy',
		async setup({ api, state }) {
			const approver = await Api.login('priya');
			await approver.call(`${CHANGE_REQUEST_API}.approve_change_request`, { name: state.changeRequest });
			await approver.dispose();
			const merger = await Api.login('grace');
			await merger.call(`${CHANGE_REQUEST_API}.merge_change_request`, { name: state.changeRequest });
			await merger.dispose();
			const reader = await Api.login('kenji');
			await reindexSearch(api, reader, 'deploy', 'engineering/');
			await reader.dispose();
		},
	},
	{
		name: 'reader-search',
		user: 'kenji',
		continue: true,
		crop: (page) => openReaderSearch(page, 'deploy'),
	},
];
