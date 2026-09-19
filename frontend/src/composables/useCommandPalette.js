import { ref } from 'vue';

const showCommandPalette = ref(false);

export function useCommandPalette() {
	function open() {
		showCommandPalette.value = true;
	}

	function close() {
		showCommandPalette.value = false;
	}

	function toggle() {
		showCommandPalette.value = !showCommandPalette.value;
	}

	return { showCommandPalette, open, close, toggle };
}
