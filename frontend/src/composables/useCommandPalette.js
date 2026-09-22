import { ref } from 'vue';

import { useTelemetry } from '../telemetry';

const showCommandPalette = ref(false);

function show(trigger) {
	showCommandPalette.value = true;
	useTelemetry().capture('command_palette_opened', { trigger });
}

export function useCommandPalette() {
	function open(trigger = 'click') {
		show(trigger);
	}

	function close() {
		showCommandPalette.value = false;
	}

	function toggle(trigger = 'shortcut') {
		if (showCommandPalette.value) close();
		else show(trigger);
	}

	return { showCommandPalette, open, close, toggle };
}
