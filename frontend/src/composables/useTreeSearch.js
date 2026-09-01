import fuzzysort from 'fuzzysort';
import { computed, ref } from 'vue';

// Client-side fuzzy filter for the editor tree. The whole tree is already in
// memory, so we match titles/routes here rather than hitting the backend.
//
// A filtered *hierarchy* hides matches behind collapsed parents and forces the
// tree to fake its own expand state, so searching swaps the tree for a flat
// result list instead: every hit is one row, ranked by score.
export function useTreeSearch(treeData) {
	const query = ref('');

	const result = computed(() =>
		filterTree(treeData.value?.children || [], query.value),
	);

	return {
		query,
		isSearching: computed(() => result.value !== null),
		matches: computed(() => result.value?.matches || []),
		hasResults: computed(
			() => !result.value || result.value.matches.length > 0,
		),
		scoreMap: computed(() => result.value?.score || null),
	};
}

// Drop weak matches (fuzzysort scores 0..1, 1 = perfect). We threshold each key
// separately: titles get a lenient cut so a near-prefix like "stat" still finds
// "Getting Started", while routes get a strict cut because they're long — a
// short query like "cli" scatter-matches "c…l…i" across ".../installation",
// which we want to ignore. Strong slug matches (e.g. "auth-tokens") still clear
// the route bar.
const TITLE_THRESHOLD = 0.3;
const ROUTE_THRESHOLD = 0.5;

// Pure core (no Vue) so it's unit-testable. Returns null when the query is
// blank (meaning "not searching, render the full tree"), otherwise the flat
// matches in rank order plus the score map the renderer highlights from.
export function filterTree(children, query) {
	const q = (query || '').trim();
	if (!q) return null;

	// Match title OR route; fuzzysort ranks each row by its best key.
	const hits = fuzzysort
		.go(q, flatten(children), {
			keys: ['node.title', 'node.route'],
		})
		.filter(
			(hit) =>
				hit[0].score >= TITLE_THRESHOLD || hit[1].score >= ROUTE_THRESHOLD,
		);

	const score = new Map(); // doc_key -> result ([0]=title, [1]=route)
	const matches = []; // rank-ordered rows
	for (const hit of hits) {
		const { node } = hit.obj;
		score.set(node.doc_key, hit);
		// One row per hit: a match's own children are not results, and keeping
		// them would rebuild the hierarchy this list exists to flatten.
		matches.push({ ...node, children: [] });
	}

	return { matches, score };
}

// Split a fuzzysort result into { text, matched } segments for rendering.
// Returns plain data (never an HTML string) so titles/routes containing markup
// render as escaped text via Vue, not live HTML — fuzzysort's own highlight()
// does NOT escape, so feeding it to v-html would be an XSS hole. Returns null
// when this key didn't actually match (no indexes).
export function highlightSegments(result) {
	const target = result?.target;
	const indexes = result?.indexes;
	if (!target || !indexes?.length) return null;

	const matched = new Set(indexes);
	const segments = [];
	let text = target[0];
	let isMatched = matched.has(0);
	for (let i = 1; i < target.length; i++) {
		const m = matched.has(i);
		if (m === isMatched) {
			text += target[i];
		} else {
			segments.push({ text, matched: isMatched });
			text = target[i];
			isMatched = m;
		}
	}
	segments.push({ text, matched: isMatched });
	return segments;
}

// Flatten to every node in the tree, at every depth, so a nested page can be
// its own result row.
function flatten(children, out = []) {
	for (const node of children) {
		out.push({ node });
		if (node.children?.length) {
			flatten(node.children, out);
		}
	}
	return out;
}
