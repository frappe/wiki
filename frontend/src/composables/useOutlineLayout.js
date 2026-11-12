import { useElementSize } from '@vueuse/core';
import { computed, toValue } from 'vue';

// Measure the element, not the viewport: the app nav takes part of the width.
// The rail needs the 768px column plus its own gutter. Below that the strip shows.
const TOC_RAIL_RESERVE = 240;
const TOC_RAIL_MIN_WIDTH = 768 + TOC_RAIL_RESERVE;

export function useOutlineLayout(containerRef, showOutline) {
	const { width } = useElementSize(containerRef);
	const showTocRail = computed(
		() => toValue(showOutline) && width.value >= TOC_RAIL_MIN_WIDTH,
	);
	// Width is 0 until the first resize callback. Showing neither until then
	// stops the strip from flashing on a wide screen.
	const showTocStrip = computed(
		() => toValue(showOutline) && width.value > 0 && !showTocRail.value,
	);
	return { showTocRail, showTocStrip };
}
