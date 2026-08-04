/**
 * The space's tree, shared from the space route down to whichever panel the
 * child route mounted.
 *
 * A child route can't be handed the tree as a prop without also handing it to
 * its siblings, so this is provided once by SpaceDetails. The value is the same
 * legacy (snake_case) tree the sidebar renders — the draft tree in the editor,
 * the published one in a git-synced space — so a page moved in an unmerged
 * change request reads its new home immediately.
 */
export const SPACE_TREE_KEY = Symbol('spaceTree');

/**
 * The chain of nodes from a top-level node down to the first match, the matched
 * node last. Null when nothing matches.
 */
export function trailToNode(nodes, matches, trail = []) {
	for (const node of nodes || []) {
		const nextTrail = [...trail, node];
		if (matches(node)) return nextTrail;
		const found = trailToNode(node.children, matches, nextTrail);
		if (found) return found;
	}
	return null;
}

/** The first readable page in a subtree, depth first. Groups hold no content. */
export function firstPageIn(nodes) {
	for (const node of nodes || []) {
		if (!node.is_group && node.document_name) return node.document_name;
		if (node.is_group) {
			const found = firstPageIn(node.children);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Where a breadcrumb goes when clicked. A group holds no content of its own, so
 * it opens the first page beneath it, the same page the space opens on.
 *
 * Every crumb wants one: without a route frappe-ui renders the crumb as a
 * button, which looks and announces like something to press while doing
 * nothing. Only a group with no pages in it is left inert.
 */
export function crumbRoute(node, spaceId) {
	const pageId = node.is_group
		? firstPageIn(node.children)
		: node.document_name;
	if (pageId) return { name: 'SpacePage', params: { spaceId, pageId } };
	// A page created in an unmerged change request has no Wiki Document yet.
	if (!node.is_group && node.doc_key) {
		return {
			name: 'DraftChangeRequest',
			params: { spaceId, docKey: node.doc_key },
		};
	}
	return undefined;
}
