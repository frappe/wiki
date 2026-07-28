import fuzzysort from 'fuzzysort';
import { computed, ref } from 'vue';

// Client-side fuzzy filter for the editor tree. The whole tree is already in
// memory, so we match titles/routes here and prune the tree in place rather
// than hitting the backend.
export function useTreeSearch(treeData) {
	const query = ref('');

	const result = computed(() =>
		filterTree(treeData.value?.children || [], query.value),
	);

	const isSearching = computed(() => result.value !== null);

	const treeForRender = computed(() => {
		if (!result.value) return treeData.value;
		return { ...treeData.value, children: result.value.children };
	});

	return {
		query,
		isSearching,
		treeForRender,
		hasResults: computed(() => !result.value || result.value.keep.size > 0),
		expandedOverride: computed(() => result.value?.expand || null),
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
// blank (meaning "not searching, render the full tree"), otherwise the pruned
// children plus the keep/expand/score sets the renderer needs.
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

	const keep = new Set(); // doc_keys that survive the prune
	const expand = new Set(); // group doc_keys to force-open
	const score = new Map(); // doc_key -> result ([0]=title, [1]=route)
	for (const hit of hits) {
		const { node, ancestorKeys } = hit.obj;
		keep.add(node.doc_key);
		score.set(node.doc_key, hit);
		for (const key of ancestorKeys) {
			keep.add(key);
			expand.add(key);
		}
	}

	return { keep, expand, score, children: prune(children, keep) };
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

// Flatten to every node paired with its ancestor keys, so a match can pull its
// parent groups back into the pruned tree.
function flatten(children, ancestorKeys = [], out = []) {
	for (const node of children) {
		out.push({ node, ancestorKeys });
		if (node.children?.length) {
			flatten(node.children, [...ancestorKeys, node.doc_key], out);
		}
	}
	return out;
}

// Structural copy with non-matching branches removed, original order kept —
// position in the tree is the point, so we never reorder by score.
function prune(children, keep) {
	const result = [];
	for (const node of children) {
		if (!keep.has(node.doc_key)) continue;
		result.push({ ...node, children: prune(node.children || [], keep) });
	}
	return result;
}
