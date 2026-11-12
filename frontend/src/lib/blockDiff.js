// Block and word diffs for the change request review. Blocks are
// `{ tag, html, key }`: `key` decides whether two blocks are the same, `html`
// is what renders.

const WORD_DIFF_TAGS = new Set([
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'li',
	'pre',
]);
// ponytail: quadratic LCS; past this many cells an edited block shows whole, before and after.
const MAX_WORD_DIFF_CELLS = 250_000;

const INS_CLASS = 'rounded-1 bg-surface-green-3 text-ink-green-7 no-underline';
const DEL_CLASS = 'rounded-1 bg-surface-red-3 text-ink-red-7';

// Each top-level element is a block, except that a list gives one block per
// item, still inside its list so bullets, numbers and task boxes render.
export function splitBlocks(html) {
	const body = new DOMParser().parseFromString(html || '', 'text/html').body;
	return [...body.children].flatMap((element) =>
		element.tagName === 'UL' || element.tagName === 'OL'
			? listItems(element)
			: [
					{
						// A diagram's text is its source; word marks inside would break it.
						tag: element.matches('pre.mermaid')
							? 'mermaid'
							: element.tagName.toLowerCase(),
						html: element.outerHTML,
						key: element.outerHTML,
					},
			  ],
	);
}

function listItems(list) {
	const shell = list.cloneNode(false).outerHTML;
	const start = Number(list.getAttribute('start') || 1);
	return [...list.children].map((item, index) => {
		const wrapper = list.cloneNode(false);
		if (list.tagName === 'OL')
			wrapper.setAttribute('start', String(start + index));
		wrapper.append(item.cloneNode(true));
		// Numbering stays out of the key, or one inserted item would change every item after it.
		return { tag: 'li', html: wrapper.outerHTML, key: shell + item.outerHTML };
	});
}

export function diffBlocks(before = [], after = []) {
	const ops = lcs(before, after, (a, b) => a.key === b.key);
	const rows = [];
	let index = 0;
	while (index < ops.length) {
		if (ops[index].op === 'same') {
			rows.push({ kind: 'same', before: ops[index].a, after: ops[index].b });
			index++;
			continue;
		}
		const removed = [];
		const added = [];
		while (index < ops.length && ops[index].op !== 'same') {
			if (ops[index].op === 'del') removed.push(ops[index].a);
			else added.push(ops[index].b);
			index++;
		}
		rows.push(...pairEdits(removed, added));
	}
	return rows;
}

// ponytail: pairs a removed run with an added run by position; a moved block shows as removed and added.
function pairEdits(removed, added) {
	const rows = [];
	for (let i = 0; i < Math.max(removed.length, added.length); i++) {
		const old = removed[i];
		const next = added[i];
		if (old && next && old.tag === next.tag) {
			rows.push({
				kind: 'change',
				before: old,
				after: next,
				tokens: wordTokens(old, next),
			});
			continue;
		}
		if (old) rows.push({ kind: 'del', before: old });
		if (next) rows.push({ kind: 'add', after: next });
	}
	return rows;
}

function wordTokens(before, after) {
	if (!WORD_DIFF_TAGS.has(before.tag)) return null;
	const a = tokenize(before.html);
	const b = tokenize(after.html);
	if (a.length * b.length > MAX_WORD_DIFF_CELLS) return null;
	return lcs(a, b, (x, y) => x === y).map(({ op, a: old, b: next }) => ({
		op,
		text: op === 'add' ? next : old,
	}));
}

export function tokenize(html) {
	return html.match(/<[^>]*>|&#?\w+;|\s+|[\p{L}\p{N}_]+|[^<\s]/gu) ?? [];
}

export function foldUnchanged(rows) {
	const folded = [];
	let run = 0;
	for (const row of rows) {
		if (row.kind === 'same') {
			run++;
			continue;
		}
		if (run) folded.push({ kind: 'gap', count: run });
		run = 0;
		folded.push(row);
	}
	if (run) folded.push({ kind: 'gap', count: run });
	return folded;
}

export function summarize(rows) {
	const count = (kind) => rows.filter((row) => row.kind === kind).length;
	return {
		added: count('add'),
		edited: count('change'),
		removed: count('del'),
	};
}

// One side of an edited block: that side's own tokens, so its markup is whole.
export function renderSide(tokens, side) {
	const own = side === 'before' ? 'del' : 'add';
	return renderRuns(
		tokens.filter((token) => token.op === 'same' || token.op === own),
		(op) => (op === 'del' ? 'del' : op === 'add' ? 'ins' : null),
	);
}

// Both sides in one block: the after side's markup, with deleted words put back as text.
export function renderInline(tokens) {
	return renderRuns(
		tokens.filter((token) => token.op !== 'del' || !isTag(token.text)),
		(op) => (op === 'del' ? 'del' : op === 'add' ? 'ins' : null),
	);
}

function renderRuns(tokens, wrapperFor) {
	let html = '';
	let open = null;
	for (const { op, text } of tokens) {
		const wrapper = isTag(text) ? null : wrapperFor(op);
		if (wrapper !== open) {
			if (open) html += `</${open}>`;
			if (wrapper)
				html += `<${wrapper} class="${
					wrapper === 'ins' ? INS_CLASS : DEL_CLASS
				}">`;
			open = wrapper;
		}
		html += text;
	}
	if (open) html += `</${open}>`;
	return html;
}

function isTag(text) {
	return text.startsWith('<');
}

function lcs(a, b, equal) {
	const table = Array.from(
		{ length: a.length + 1 },
		() => new Uint32Array(b.length + 1),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i][j] = equal(a[i], b[j])
				? table[i + 1][j + 1] + 1
				: Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}
	const ops = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (equal(a[i], b[j])) ops.push({ op: 'same', a: a[i++], b: b[j++] });
		else if (table[i + 1][j] >= table[i][j + 1])
			ops.push({ op: 'del', a: a[i++] });
		else ops.push({ op: 'add', b: b[j++] });
	}
	while (i < a.length) ops.push({ op: 'del', a: a[i++] });
	while (j < b.length) ops.push({ op: 'add', b: b[j++] });
	return ops;
}
