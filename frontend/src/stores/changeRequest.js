import { useUserStore } from '@/stores/user';
import { createResource } from 'frappe-ui';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useChangeRequestStore = defineStore('changeRequest', () => {
	const currentChangeRequest = ref(null);
	const isLoadingChangeRequest = ref(false);
	// 'merging' | 'withdrawing' | null, for the whole round trip including the
	// rehydrate that follows it. The CR walks Draft -> In Review -> Approved ->
	// merged on the way, and the banner would otherwise render each of those in
	// turn — a flash of "Approved! Ready to merge." on the way to a merge the
	// user already asked for. Owned by whoever runs the flow (SpaceDetails),
	// because it has to outlive the call itself.
	const finalizing = ref(null);
	let initChangeRequestPromise = null;
	let loadChangesPromise = null;

	const isChangeRequestMode = computed(
		() => useUserStore().shouldUseChangeRequestMode,
	);
	const hasActiveChangeRequest = computed(() => !!currentChangeRequest.value);

	const changeRequestResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_change_request',
		onSuccess(data) {
			currentChangeRequest.value = data;
		},
	});

	const draftChangeRequestResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.get_or_create_draft_change_request',
		onSuccess(data) {
			currentChangeRequest.value = data;
			isLoadingChangeRequest.value = false;
		},
		onError(error) {
			console.error('Failed to get/create change request:', error);
			isLoadingChangeRequest.value = false;
		},
	});

	const changesResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.diff_change_request',
	});

	const submitReviewResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.submit_change_request',
		onSuccess() {
			refreshChangeRequest();
		},
	});

	const archiveChangeRequestResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.archive_change_request',
		onSuccess() {
			currentChangeRequest.value = null;
		},
	});

	const mergeChangeRequestResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.merge_change_request',
	});

	const approveChangeRequestResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.approve_change_request',
	});

	const applyOperationsResource = createResource({
		url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.apply_cr_operations',
	});

	async function refreshChangeRequest() {
		if (!currentChangeRequest.value) return null;
		await changeRequestResource.submit({
			name: currentChangeRequest.value.name,
		});
		return currentChangeRequest.value;
	}

	async function initChangeRequest(spaceId) {
		if (!isChangeRequestMode.value || !spaceId) return null;

		if (isLoadingChangeRequest.value && initChangeRequestPromise) {
			await initChangeRequestPromise;
			return currentChangeRequest.value;
		}

		isLoadingChangeRequest.value = true;
		initChangeRequestPromise = draftChangeRequestResource.submit({
			wiki_space: spaceId,
		});
		try {
			await initChangeRequestPromise;
		} finally {
			initChangeRequestPromise = null;
		}
		return currentChangeRequest.value;
	}

	async function ensureChangeRequest(spaceId) {
		if (!currentChangeRequest.value) {
			await initChangeRequest(spaceId);
		}
		return !!currentChangeRequest.value;
	}

	async function loadChanges() {
		if (!currentChangeRequest.value) return [];
		if (loadChangesPromise) return loadChangesPromise;

		loadChangesPromise = changesResource
			.submit({
				name: currentChangeRequest.value.name,
				scope: 'summary',
			})
			.then(() => changesResource.data || [])
			.finally(() => {
				loadChangesPromise = null;
			});

		return loadChangesPromise;
	}

	async function submitForReview() {
		if (!currentChangeRequest.value) return null;
		await submitReviewResource.submit({
			name: currentChangeRequest.value.name,
		});
		return currentChangeRequest.value;
	}

	async function archiveChangeRequest() {
		if (!currentChangeRequest.value) return null;
		await archiveChangeRequestResource.submit({
			name: currentChangeRequest.value.name,
		});
		return currentChangeRequest.value;
	}

	async function mergeChangeRequest() {
		if (!currentChangeRequest.value) return null;
		await mergeChangeRequestResource.submit({
			name: currentChangeRequest.value.name,
		});
		return currentChangeRequest.value;
	}

	// One-click self-serve publish from the editor. Merge now requires an
	// Approved CR, so we walk the CR up the state machine first: submit a
	// Draft / Changes-Requested CR into review, approve it, then merge. An
	// already-Approved CR (e.g. someone else approved it) skips straight to
	// the merge. The merge step may still throw on a conflict — the caller
	// hands those off to the review page's conflict UI.
	async function approveAndMergeChangeRequest() {
		if (!currentChangeRequest.value) return null;
		const name = currentChangeRequest.value.name;

		if (
			['Draft', 'Changes Requested'].includes(currentChangeRequest.value.status)
		) {
			await submitReviewResource.submit({ name });
			await refreshChangeRequest();
		}
		if (currentChangeRequest.value.status === 'In Review') {
			await approveChangeRequestResource.submit({ name });
			await refreshChangeRequest();
		}
		await mergeChangeRequestResource.submit({ name });
		return currentChangeRequest.value;
	}

	// The summary belongs to a change request that no longer exists once it is
	// merged; leaving it around lets the old count drive the banner until the
	// next CR's summary lands.
	function clearChanges() {
		changesResource.data = [];
	}

	const changes = computed(() => changesResource.data || []);
	const changeCount = computed(() => changes.value.length);
	const isSubmitting = computed(() => submitReviewResource.loading);
	const isArchiving = computed(() => archiveChangeRequestResource.loading);
	const isMerging = computed(
		() =>
			mergeChangeRequestResource.loading ||
			approveChangeRequestResource.loading,
	);

	const canSubmit = computed(() => {
		return (
			['Draft', 'Changes Requested'].includes(
				currentChangeRequest.value?.status,
			) && changeCount.value > 0
		);
	});

	const canWithdraw = computed(() => {
		return ['In Review', 'Changes Requested'].includes(
			currentChangeRequest.value?.status,
		);
	});

	// Batched mutation entrypoint. The backend applies the whole list atomically
	// inside its request transaction, returns a temp_key_map for any newly
	// created nodes, the canonical affected items, deleted doc_keys, the
	// change summary and the new operation_version. Callers should pass the last `operation_version`
	// they observed as `baseVersion` so the server can detect concurrent edits
	// and respond with a structured `version_conflict` instead of clobbering.
	async function applyOperations(changeRequestName, baseVersion, operations) {
		const result = await applyOperationsResource.submit({
			name: changeRequestName,
			base_version: baseVersion,
			operations,
		});
		if (
			result?.changes &&
			currentChangeRequest.value?.name === changeRequestName
		) {
			changesResource.data = result.changes;
		}
		return result;
	}

	return {
		currentChangeRequest,
		isLoadingChangeRequest,
		finalizing,
		isChangeRequestMode,
		hasActiveChangeRequest,
		changes,
		changeCount,
		canSubmit,
		canWithdraw,
		isSubmitting,
		isArchiving,
		isMerging,
		refreshChangeRequest,
		initChangeRequest,
		ensureChangeRequest,
		loadChanges,
		clearChanges,
		submitForReview,
		archiveChangeRequest,
		mergeChangeRequest,
		approveAndMergeChangeRequest,
		applyOperations,
	};
});
