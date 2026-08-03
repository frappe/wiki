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
