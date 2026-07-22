import { useDraftWorkspaceStore } from '@/stores/draftWorkspace';
import { toast } from 'frappe-ui';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

export function useTreeDialogs(spaceId, expandedNodes) {
	const draftStore = useDraftWorkspaceStore();
	const router = useRouter();

	const showCreateDialog = ref(false);
	const createTitle = ref('');
	const createParent = ref(null);
	const createIsGroup = ref(false);

	const showDeleteDialog = ref(false);
	const deleteNode = ref(null);
	const deleteChildCount = ref(0);

	const showRenameDialog = ref(false);
	const renameTitle = ref('');
	const renameNode = ref(null);

	const showExternalLinkDialog = ref(false);
	const externalLinkTitle = ref('');
	const externalLinkUrl = ref('');
	const externalLinkParent = ref(null);

	const showEditExternalLinkDialog = ref(false);
	const editExternalLinkTitle = ref('');
	const editExternalLinkUrl = ref('');
	const editExternalLinkNode = ref(null);

	const isCreating = ref(false);
	const isRenaming = ref(false);
	const isDeleting = ref(false);
	const isUpdatingExternalLink = ref(false);

	function openCreateDialog(parentKey, isGroup) {
		createParent.value = parentKey;
		createIsGroup.value = isGroup;
		createTitle.value = '';
		showCreateDialog.value = true;
	}

	function countDescendants(node) {
		if (!node?.children?.length) return 0;
		return node.children.reduce(
			(sum, child) => sum + 1 + countDescendants(child),
			0,
		);
	}

	function openDeleteDialog(node) {
		deleteNode.value = node;
		deleteChildCount.value = node?.is_group ? countDescendants(node) : 0;
		showDeleteDialog.value = true;
	}

	// Local-first create: store inserts a temp node into the tree immediately,
	// the dialog closes right away, and the backend call runs in the
	// background. Failure is surfaced through the store's mutation queue.
	async function createDocument(close) {
		const title = createTitle.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}

		const parentKey = createParent.value;
		const isGroup = createIsGroup.value;

		if (parentKey) expandedNodes.value[parentKey] = true;
		close();

		isCreating.value = true;
		try {
			const { tempKey, promise } = draftStore.createNode({
				parentKey,
				title,
				isGroup,
			});
			// Open the new page for editing immediately. The DraftContributionPanel
			// reads its content from pagesByKey (seeded by createNode), and the
			// route remaps from tmp_* to the real key once the create syncs.
			// Groups have no editable content, so skip navigation for those.
			if (!isGroup && spaceId.value) {
				router.push({
					name: 'DraftChangeRequest',
					params: { spaceId: spaceId.value, docKey: tempKey },
				});
			}
			await promise;
		} catch (error) {
			console.error('Error creating page:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isCreating.value = false;
		}
	}

	async function deleteDocument(close) {
		const docKey = deleteNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isDeleting.value = true;
		try {
			await draftStore.deleteNode(docKey);
		} catch (error) {
			console.error('Error creating delete draft:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isDeleting.value = false;
		}
	}

	function openRenameDialog(node) {
		renameNode.value = node;
		renameTitle.value = node.title || '';
		showRenameDialog.value = true;
	}

	async function renameDocument(close) {
		const title = renameTitle.value.trim();
		if (!title) {
			toast.warning(__('Name is required'));
			return;
		}
		const docKey = renameNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isRenaming.value = true;
		try {
			await draftStore.renameNode(docKey, title);
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error updating title'));
		} finally {
			isRenaming.value = false;
		}
	}

	function openExternalLinkDialog(parentKey) {
		externalLinkParent.value = parentKey;
		externalLinkTitle.value = '';
		externalLinkUrl.value = '';
		showExternalLinkDialog.value = true;
	}

	async function createExternalLink(close) {
		const title = externalLinkTitle.value.trim();
		const url = externalLinkUrl.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}
		if (!url) {
			toast.warning(__('URL is required'));
			return;
		}

		const parentKey = externalLinkParent.value;
		if (parentKey) expandedNodes.value[parentKey] = true;
		close();

		isCreating.value = true;
		try {
			const { promise } = draftStore.createNode({
				parentKey,
				title,
				isExternalLink: true,
				externalUrl: url,
			});
			await promise;
		} catch (error) {
			console.error('Error creating external link:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		} finally {
			isCreating.value = false;
		}
	}

	function openEditExternalLinkDialog(node) {
		editExternalLinkNode.value = node;
		editExternalLinkTitle.value = node.title || '';
		editExternalLinkUrl.value = node.external_url || '';
		showEditExternalLinkDialog.value = true;
	}

	async function updateExternalLink(close) {
		const title = editExternalLinkTitle.value.trim();
		const url = editExternalLinkUrl.value.trim();
		if (!title) {
			toast.warning(__('Title is required'));
			return;
		}
		if (!url) {
			toast.warning(__('URL is required'));
			return;
		}
		const docKey = editExternalLinkNode.value?.doc_key;
		if (!docKey) {
			close();
			return;
		}
		close();
		isUpdatingExternalLink.value = true;
		try {
			await draftStore.updateNode(docKey, {
				title,
				external_url: url,
			});
		} catch (error) {
			console.error('Error updating external link:', error);
			toast.error(error.messages?.[0] || __('Error updating external link'));
		} finally {
			isUpdatingExternalLink.value = false;
		}
	}

	return {
		showCreateDialog,
		createTitle,
		createIsGroup,
		showDeleteDialog,
		deleteNode,
		deleteChildCount,
		showRenameDialog,
		renameTitle,
		renameNode,
		showExternalLinkDialog,
		externalLinkTitle,
		externalLinkUrl,
		showEditExternalLinkDialog,
		editExternalLinkTitle,
		editExternalLinkUrl,
		isCreating,
		isRenaming,
		isDeleting,
		isUpdatingExternalLink,
		openCreateDialog,
		openDeleteDialog,
		createDocument,
		deleteDocument,
		openRenameDialog,
		renameDocument,
		openExternalLinkDialog,
		createExternalLink,
		openEditExternalLinkDialog,
		updateExternalLink,
	};
}
