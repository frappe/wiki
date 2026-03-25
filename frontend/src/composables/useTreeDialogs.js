import { useChangeRequestStore } from '@/stores/changeRequest';
import { toast } from 'frappe-ui';
import { ref } from 'vue';

export function useTreeDialogs(spaceId, expandedNodes, emit) {
	const crStore = useChangeRequestStore();

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

	async function createDocument(close) {
		if (!createTitle.value.trim()) {
			toast.warning(__('Title is required'));
			return;
		}

		try {
			if (!(await crStore.ensureChangeRequest(spaceId.value))) {
				toast.error(__('Could not create change request'));
				return;
			}

			await crStore.createPage(
				crStore.currentChangeRequest.name,
				createParent.value,
				createTitle.value.trim(),
				'',
				createIsGroup.value,
			);

			toast.success(
				createIsGroup.value
					? __('Group draft created')
					: __('Page draft created'),
			);

			if (createParent.value) {
				expandedNodes.value[createParent.value] = true;
			}

			await crStore.loadChanges();
			emit('refresh');
			close();
		} catch (error) {
			console.error('Error creating page:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		}
	}

	async function deleteDocument(close) {
		try {
			if (!(await crStore.ensureChangeRequest(spaceId.value))) {
				toast.error(__('Could not create change request'));
				return;
			}

			await crStore.deletePage(
				crStore.currentChangeRequest.name,
				deleteNode.value.doc_key,
			);

			toast.success(__('Delete saved as draft'));
			await crStore.loadChanges();
			emit('refresh');
			close();
		} catch (error) {
			console.error('Error creating delete draft:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		}
	}

	function openRenameDialog(node) {
		renameNode.value = node;
		renameTitle.value = node.title || '';
		showRenameDialog.value = true;
	}

	async function renameDocument(close) {
		if (!renameTitle.value.trim()) {
			toast.warning(__('Name is required'));
			return;
		}

		try {
			if (!(await crStore.ensureChangeRequest(spaceId.value))) {
				toast.error(__('Could not create change request'));
				return;
			}

			await crStore.updatePage(
				crStore.currentChangeRequest.name,
				renameNode.value.doc_key,
				{
					title: renameTitle.value.trim(),
				},
			);
			toast.success(
				renameNode.value?.is_group ? __('Group renamed') : __('Title updated'),
			);
			await crStore.loadChanges();
			emit('refresh');
			close();
		} catch (error) {
			toast.error(error.messages?.[0] || __('Error updating title'));
		}
	}

	function openExternalLinkDialog(parentKey) {
		externalLinkParent.value = parentKey;
		externalLinkTitle.value = '';
		externalLinkUrl.value = '';
		showExternalLinkDialog.value = true;
	}

	async function createExternalLink(close) {
		if (!externalLinkTitle.value.trim()) {
			toast.warning(__('Title is required'));
			return;
		}

		if (!externalLinkUrl.value.trim()) {
			toast.warning(__('URL is required'));
			return;
		}

		try {
			if (!(await crStore.ensureChangeRequest(spaceId.value))) {
				toast.error(__('Could not create change request'));
				return;
			}

			await crStore.createPage(
				crStore.currentChangeRequest.name,
				externalLinkParent.value,
				externalLinkTitle.value.trim(),
				'',
				false,
				true,
				externalLinkUrl.value.trim(),
			);

			toast.success(__('External link draft created'));

			if (externalLinkParent.value) {
				expandedNodes.value[externalLinkParent.value] = true;
			}

			await crStore.loadChanges();
			emit('refresh');
			close();
		} catch (error) {
			console.error('Error creating external link:', error);
			toast.error(error.messages?.[0] || __('Error creating draft'));
		}
	}

	function openEditExternalLinkDialog(node) {
		editExternalLinkNode.value = node;
		editExternalLinkTitle.value = node.title || '';
		editExternalLinkUrl.value = node.external_url || '';
		showEditExternalLinkDialog.value = true;
	}

	async function updateExternalLink(close) {
		if (!editExternalLinkTitle.value.trim()) {
			toast.warning(__('Title is required'));
			return;
		}

		if (!editExternalLinkUrl.value.trim()) {
			toast.warning(__('URL is required'));
			return;
		}

		try {
			if (!(await crStore.ensureChangeRequest(spaceId.value))) {
				toast.error(__('Could not create change request'));
				return;
			}

			await crStore.updatePage(
				crStore.currentChangeRequest.name,
				editExternalLinkNode.value.doc_key,
				{
					title: editExternalLinkTitle.value.trim(),
					external_url: editExternalLinkUrl.value.trim(),
				},
			);

			toast.success(__('External link updated'));
			await crStore.loadChanges();
			emit('refresh');
			close();
		} catch (error) {
			console.error('Error updating external link:', error);
			toast.error(error.messages?.[0] || __('Error updating external link'));
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
