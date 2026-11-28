/**
 * The space's tree model, shared from the space route down to whichever panel
 * the child route mounted.
 *
 * A child route can't be handed the tree as a prop without also handing it to
 * its siblings, so this is provided once by SpaceDetails. The value is the
 * model the sidebar renders: the draft tree in the editor, the published one in
 * a git-synced space. So a page moved in an unmerged change request reads its
 * new home immediately.
 */
export const SPACE_TREE_KEY = Symbol('spaceTree');

/**
 * Where a breadcrumb goes when clicked. A group holds no content of its own, so
 * it opens the first page beneath it, the same page the space opens on.
 *
 * Every crumb wants one: without a route frappe-ui renders the crumb as a
 * button, which looks and announces like something to press while doing
 * nothing. Only a group with no pages in it is left inert.
 */
export function crumbRoute(tree, node, spaceId) {
	const pageId = node.isGroup ? tree.firstPage(node.docKey) : node.documentName;
	if (pageId) return { name: 'SpacePage', params: { spaceId, pageId } };
	// A page created in an unmerged change request has no Wiki Document yet.
	if (!node.isGroup) {
		return {
			name: 'DraftChangeRequest',
			params: { spaceId, docKey: node.docKey },
		};
	}
	return undefined;
}
