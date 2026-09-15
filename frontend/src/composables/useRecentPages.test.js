import assert from 'node:assert/strict';
import test from 'node:test';

// The composable reads the user cookie and localStorage on import. Vue is
// loaded first because a bare document object breaks its own setup.
await import('@vueuse/core');
globalThis.document = { cookie: 'user_id=alice@example.com' };
globalThis.localStorage = {
	store: new Map(),
	getItem(key) {
		return this.store.has(key) ? this.store.get(key) : null;
	},
	setItem(key, value) {
		this.store.set(key, String(value));
	},
	removeItem(key) {
		this.store.delete(key);
	},
};

const { useRecentPages } = await import('./useRecentPages.js');
const { recentPages, recordVisit } = useRecentPages();

function titles() {
	return recentPages.value.map((page) => page.title);
}

test('keeps the newest visit first', () => {
	recordVisit({ name: 'a', title: 'Alpha', space: 's1' });
	recordVisit({ name: 'b', title: 'Beta', space: 's1' });
	assert.deepEqual(titles(), ['Beta', 'Alpha']);
});

test('moves a revisited page to the top instead of repeating it', () => {
	recordVisit({ name: 'a', title: 'Alpha', space: 's1' });
	assert.deepEqual(titles(), ['Alpha', 'Beta']);
});

test('keeps a renamed page under its new title', () => {
	recordVisit({ name: 'a', title: 'Alpha Renamed', space: 's1' });
	assert.deepEqual(titles(), ['Alpha Renamed', 'Beta']);
});

test('caps the list at five', () => {
	for (const name of ['c', 'd', 'e', 'f']) {
		recordVisit({ name, title: name.toUpperCase(), space: 's1' });
	}
	assert.equal(recentPages.value.length, 5);
	assert.deepEqual(titles(), ['F', 'E', 'D', 'C', 'Alpha Renamed']);
});

test('keeps the route of the latest visit', () => {
	recordVisit({
		name: 'a',
		title: 'Alpha Renamed',
		space: 's1',
		route: 's1/alpha',
	});
	recordVisit({
		name: 'a',
		title: 'Alpha Renamed',
		space: 's1',
		route: 's1/moved',
	});
	assert.equal(recentPages.value[0].route, 's1/moved');
	assert.equal(recentPages.value.filter((page) => page.name === 'a').length, 1);
});

test('ignores a page with no title yet', () => {
	recordVisit({ name: 'g', title: '', space: 's1' });
	recordVisit({});
	assert.equal(titles().includes(''), false);
	assert.equal(recentPages.value.length, 5);
});

test('keeps each user to their own recent pages', async () => {
	globalThis.document.cookie = 'user_id=bob@example.com';
	const other = await import('./useRecentPages.js?user=bob');
	assert.deepEqual(other.useRecentPages().recentPages.value, []);
});
