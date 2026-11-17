import { useChangeRequestStore } from '@/stores/changeRequest';
import { createResource } from 'frappe-ui';
import { computed, shallowRef, watch } from 'vue';

// One request per space feeds the header count, the panel and the page notice.
export function useOpenChangeRequests(spaceId) {
	const crStore = useChangeRequestStore();
	const resource = shallowRef(null);

	watch(
		spaceId,
		(id) => {
			resource.value = id
				? createResource({
						url: 'wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request.list_open_change_requests',
						method: 'GET',
						params: { wiki_space: id },
						cache: ['open-change-requests', id],
						auto: true,
				  })
				: null;
		},
		{ immediate: true },
	);

	// Starting, submitting, merging or discarding your own change request
	// changes the list. A merge walks through several statuses; reload once it lands.
	watch(
		[
			() => crStore.currentChangeRequest?.name,
			() => crStore.currentChangeRequest?.status,
			() => crStore.finalizing,
		],
		() => {
			if (!crStore.finalizing) reload();
		},
	);

	function reload() {
		resource.value?.reload();
	}

	const changeRequests = computed(() => resource.value?.data ?? []);

	function changingPage(docKey) {
		return changeRequests.value.filter((changeRequest) =>
			changeRequest.changed_doc_keys.includes(docKey),
		);
	}

	return { changeRequests, changingPage, reload };
}
