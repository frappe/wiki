import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import {
	createTrailingScheduler,
	memoizeLast,
	onEditorFlushRequest,
	requestEditorFlush,
} from './editorContentSync.js';

/**
 * WikiEditor used to serialize and re-parse the whole page on every
 * keystroke. On a page with large inline images one parse took over 200 ms,
 * and three of them per keystroke made typing lag by seconds. The editor now
 * reports content through this scheduler and caches the canonical markdown.
 */

function withTimers(fn) {
	return () => {
		mock.timers.enable({ apis: ['setTimeout', 'Date'] });
		try {
			fn();
		} finally {
			mock.timers.reset();
		}
	};
}

function scheduler() {
	const run = mock.fn();
	return {
		run,
		sync: createTrailingScheduler({ delay: 300, maxWait: 2000, run }),
	};
}

test(
	'a burst of keystrokes runs once, after the pause',
	withTimers(() => {
		const { run, sync } = scheduler();
		for (let i = 0; i < 10; i++) {
			sync.schedule();
			mock.timers.tick(50);
		}
		assert.equal(run.mock.callCount(), 0);

		mock.timers.tick(300);
		assert.equal(run.mock.callCount(), 1);
		assert.equal(sync.pending, false);
	}),
);

test(
	'continuous typing still runs every maxWait',
	withTimers(() => {
		const { run, sync } = scheduler();
		for (let i = 0; i < 50; i++) {
			sync.schedule();
			mock.timers.tick(100);
		}
		// 5 s of typing with a 2 s max wait.
		assert.equal(run.mock.callCount(), 2);
	}),
);

test(
	'flush runs a pending call now, and only once',
	withTimers(() => {
		const { run, sync } = scheduler();
		sync.schedule();
		sync.flush();
		assert.equal(run.mock.callCount(), 1);

		mock.timers.tick(1000);
		sync.flush();
		assert.equal(run.mock.callCount(), 1);
	}),
);

test(
	'cancel drops a pending call',
	withTimers(() => {
		const { run, sync } = scheduler();
		sync.schedule();
		sync.cancel();
		mock.timers.tick(1000);
		assert.equal(run.mock.callCount(), 0);
	}),
);

test('memoizeLast recomputes only when the argument changes', () => {
	const parse = mock.fn((value) => value.toUpperCase());
	const canonical = memoizeLast(parse);
	const doc = 'page';

	assert.equal(canonical(doc), 'PAGE');
	assert.equal(canonical(doc), 'PAGE');
	assert.equal(parse.mock.callCount(), 1);

	assert.equal(canonical('other'), 'OTHER');
	assert.equal(parse.mock.callCount(), 2);
});

test('memoizeLast caches an undefined argument too', () => {
	const parse = mock.fn(() => '');
	const canonical = memoizeLast(parse);
	canonical(undefined);
	canonical(undefined);
	assert.equal(parse.mock.callCount(), 1);
});

// Submit and merge read the draft store right away. A click on their buttons
// does not always blur the editor first, so they must be able to pull the
// pending edit in, or a merge inside the 300 ms window drops the last typing.
test(
	'a flush request reports the pending edit right away',
	withTimers(() => {
		const { run, sync } = scheduler();
		const stop = onEditorFlushRequest(() => sync.flush());
		sync.schedule();

		requestEditorFlush();
		assert.equal(run.mock.callCount(), 1);

		stop();
		sync.schedule();
		requestEditorFlush();
		assert.equal(run.mock.callCount(), 1);
		sync.cancel();
	}),
);
