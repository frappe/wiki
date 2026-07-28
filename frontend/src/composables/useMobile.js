import { useMediaQuery } from '@vueuse/core';

// Single source of truth for "are we on a phone?" — reactive to resize/rotation,
// unlike CRM's non-reactive `window.innerWidth < 768`. Breakpoint matches Tailwind `md`.
const isMobile = useMediaQuery('(max-width: 767px)');

export function useMobile() {
	return { isMobile };
}
