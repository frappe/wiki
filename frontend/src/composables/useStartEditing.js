import { ref } from 'vue';
import { useSpaceStore } from '../stores/space';

const request = ref(null);

export function useStartEditing() {
	const spaceStore = useSpaceStore();

	// A page's Edit passes the open change requests that change it, so the
	// dialog can warn before a second author edits the same page.
	function requireEditing({ changeRequests = [] } = {}) {
		if (spaceStore.isEditing) return Promise.resolve(true);
		if (!spaceStore.isReading) return Promise.resolve(false);
		if (request.value) return request.value.promise;
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		request.value = { promise, resolve, changeRequests };
		return promise;
	}

	function settle(started) {
		request.value?.resolve(started);
		request.value = null;
	}

	return { request, requireEditing, settle };
}
