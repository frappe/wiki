import { toast } from 'frappe-ui';
import { ref } from 'vue';
import { useSpaceStore } from '../stores/space';

const request = ref(null);
let startingFirstPages = null;

export function useStartEditing() {
	const spaceStore = useSpaceStore();

	function requireEditing() {
		if (spaceStore.isEditing) return Promise.resolve(true);
		if (!spaceStore.isReading) return Promise.resolve(false);
		if (request.value) return request.value.promise;
		// An empty space has nothing to describe yet, so naming the change request is just friction.
		if (spaceStore.treeData?.children?.length === 0) return startFirstPages();
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		request.value = { promise, resolve };
		return promise;
	}

	function startFirstPages() {
		startingFirstPages ??= spaceStore
			.startEditing({ title: __('Add initial content'), description: null })
			.then(() => true)
			.catch((error) => {
				toast.error(error.messages?.[0] || __('Could not start editing'));
				return false;
			})
			.finally(() => {
				startingFirstPages = null;
			});
		return startingFirstPages;
	}

	function settle(started) {
		request.value?.resolve(started);
		request.value = null;
	}

	return { request, requireEditing, settle };
}
