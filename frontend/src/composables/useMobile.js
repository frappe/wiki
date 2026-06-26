import { useMediaQuery } from '@vueuse/core';
import { ref } from 'vue';

// Single source of truth for "are we on a phone?" — reactive to resize/rotation,
// unlike CRM's non-reactive `window.innerWidth < 768`. Breakpoint matches Tailwind `md`.
const isMobile = useMediaQuery('(max-width: 767px)');

// Shared open/close state for the off-canvas global-nav drawer (Phase 1).
const mobileNavOpen = ref(false);

export function useMobile() {
	return { isMobile, mobileNavOpen };
}
