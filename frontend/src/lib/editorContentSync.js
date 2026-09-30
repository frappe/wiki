/**
 * Run `run` once typing pauses for `delay` ms, and at least every `maxWait`
 * ms while it continues. `flush` runs a pending call now; callers flush before
 * anything reads the result (blur, save, unmount).
 */
export function createTrailingScheduler({ delay, maxWait, run }) {
	let timer = null;
	let firstScheduledAt = null;

	function cancel() {
		clearTimeout(timer);
		timer = null;
		firstScheduledAt = null;
	}

	function flush() {
		if (timer === null) return;
		cancel();
		run();
	}

	function schedule() {
		const now = Date.now();
		firstScheduledAt ??= now;
		const untilMaxWait = firstScheduledAt + maxWait - now;
		clearTimeout(timer);
		timer = setTimeout(flush, Math.max(0, Math.min(delay, untilMaxWait)));
	}

	return {
		schedule,
		flush,
		cancel,
		get pending() {
			return timer !== null;
		},
	};
}

/**
 * Cache `fn` for its most recent argument, compared by identity. ProseMirror
 * docs are immutable and prop strings are replaced, not mutated, so identity
 * is enough to know the input has not changed.
 */
export function memoizeLast(fn) {
	let hasValue = false;
	let lastArg;
	let lastValue;
	return (arg) => {
		if (!hasValue || arg !== lastArg) {
			lastValue = fn(arg);
			lastArg = arg;
			hasValue = true;
		}
		return lastValue;
	};
}
