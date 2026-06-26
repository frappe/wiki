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

// Pure core (no Vue) so it's unit-testable. Returns null when the query is
// blank (meaning "not searching, render the full tree"), otherwise the pruned
// children plus the keep/expand/score sets the renderer needs.
export function filterTree(children, query) {
	const q = (query || '').trim();
	if (!q) return null;

	// Match title OR route; fuzzysort ranks each row by its best key.
	const hits = fuzzysort.go(q, flatten(children), {
		keys: ['node.title', 'node.route'],
	});

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
