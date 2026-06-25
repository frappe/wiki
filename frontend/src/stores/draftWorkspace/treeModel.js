import { computed, ref } from 'vue';

// Normalize a server tree node (snake_case from get_cr_tree) into a DraftNode.
export function normalizeNode(serverNode, parentKey = null) {
	const docKey = serverNode.doc_key;
	const children = (serverNode.children || []).map((c) =>
		normalizeNode(c, docKey),
	);
	return {
		docKey,
		serverDocKey: docKey,
		documentName: serverNode.document_name ?? null,
		title: serverNode.title || '',
		route: serverNode.route || '',
		parentKey,
		orderIndex: serverNode.order_index ?? null,
		isGroup: !!serverNode.is_group,
		isPublished: serverNode.is_published !== false,
		isExternalLink: !!serverNode.is_external_link,
		externalUrl: serverNode.external_url || null,
		children,
		localStatus: null,
	};
}

// Convert a DraftNode back to the snake_case shape existing components consume
// (NestedDraggable, WikiDocumentList, etc.). Lets us migrate incrementally.
export function denormalizeNode(node) {
	return {
		doc_key: node.docKey,
		document_name: node.documentName,
		title: node.title,
		route: node.route,
		is_group: node.isGroup,
		is_published: node.isPublished,
		is_external_link: node.isExternalLink,
		external_url: node.externalUrl,
		order_index: node.orderIndex,
		children: node.children.map(denormalizeNode),
		local_status: node.localStatus,
	};
}

// Pure tree model: owns the `tree` ref + `rootKey` and the local-only mutations
// against them. No network, no queue, no persistence — those modules sit
// above this one.
export function createTreeModel() {
	const rootKey = ref(null);
	const tree = ref([]);

	function findNode(docKey, nodes = tree.value) {
		for (const node of nodes) {
			if (node.docKey === docKey) return node;
			const found = findNode(docKey, node.children);
			if (found) return found;
		}
		return null;
	}

	function getChildList(parentKey) {
		if (!parentKey || parentKey === rootKey.value) return tree.value;
		return findNode(parentKey)?.children || null;
	}

	function insertNode(node, parentKey) {
		const list = getChildList(parentKey);
		if (list) list.push(node);
	}

	function removeNodeByKey(docKey) {
		const removeFrom = (list) => {
			const idx = list.findIndex((n) => n.docKey === docKey);
			if (idx >= 0) return list.splice(idx, 1)[0];
			for (const n of list) {
				const found = removeFrom(n.children);
				if (found) return found;
			}
			return null;
		};
		return removeFrom(tree.value);
	}

	function applyServerTree(serverTree) {
		rootKey.value = serverTree?.root_group || null;
		tree.value = (serverTree?.children || []).map((c) =>
			normalizeNode(c, rootKey.value),
		);
	}

	// Filter pending_delete nodes out of the legacy view so deletion feels
	// immediate. They're restored if the backend call fails.
	const treeAsLegacy = computed(() => {
		const filterDeleted = (nodes) =>
			nodes
				.filter((n) => n.localStatus !== 'pending_delete')
				.map((n) => ({
					...denormalizeNode(n),
					children: filterDeleted(n.children),
				}));
		return {
			root_group: rootKey.value,
			children: filterDeleted(tree.value),
		};
	});

	function reset() {
		rootKey.value = null;
		tree.value = [];
	}

	return {
		rootKey,
		tree,
		treeAsLegacy,
		findNode,
		getChildList,
		insertNode,
		removeNodeByKey,
		applyServerTree,
		reset,
	};
}
