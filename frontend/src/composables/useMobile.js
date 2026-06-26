import { useMediaQuery } from '@vueuse/core';
import { ref } from 'vue';

// Single source of truth for "are we on a phone?" — reactive to resize/rotation,
// unlike CRM's non-reactive `window.innerWidth < 768`. Breakpoint matches Tailwind `md`.
const isMobile = useMediaQuery('(max-width: 767px)');

// Set by a page that teleports its own leading control into the mobile top nav
// (e.g. SpaceDetails' tree toggle). The top nav hides its logo when so, since
// the page's control already occupies the left — keeping the logo only where a
// page provides no leading control (the list views).
const mobileHasLeadingControl = ref(false);

export function useMobile() {
	return { isMobile, mobileHasLeadingControl };
}
