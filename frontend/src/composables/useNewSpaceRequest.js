import { ref } from 'vue';

const pending = ref(false);

export function useNewSpaceRequest() {
	function requestNewSpace() {
		pending.value = true;
	}

	function consumeNewSpaceRequest() {
		if (!pending.value) return false;
		pending.value = false;
		return true;
	}

	return { pending, requestNewSpace, consumeNewSpaceRequest };
}
