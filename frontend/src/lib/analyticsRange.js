export const PRESETS = [
	{ value: '7d', days: 7 },
	{ value: '30d', days: 30 },
	{ value: '90d', days: 90 },
	{ value: '180d', days: 180 },
	{ value: '12m', days: 365 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateString(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate(),
	)}`;
}

function parseDate(value) {
	const [year, month, day] = value.split('-').map(Number);
	return new Date(year, month - 1, day);
}

function addDays(value, days) {
	const date = parseDate(value);
	date.setDate(date.getDate() + days);
	return toDateString(date);
}

export function presetRange(days, today = new Date()) {
	const to = toDateString(today);
	return [addDays(to, 1 - days), to];
}

export function daysIn([from, to]) {
	return Math.round((parseDate(to) - parseDate(from)) / DAY_MS) + 1;
}

export function intervalFor(range) {
	const days = daysIn(range);
	if (days <= 90) return 'daily';
	if (days <= 180) return 'weekly';
	return 'monthly';
}

export function drillDownRange(bucket, interval, [from, to]) {
	let end;
	if (interval === 'weekly') {
		end = addDays(bucket, 6);
	} else if (interval === 'monthly') {
		const start = parseDate(bucket);
		end = toDateString(new Date(start.getFullYear(), start.getMonth() + 1, 0));
	} else {
		return null;
	}
	return [bucket < from ? from : bucket, end > to ? to : end];
}
