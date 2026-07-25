<template>
	<span :class="[iconClass, sizeClass]" aria-hidden="true" />
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
	// A lucide class name stored on the document, e.g. 'lucide-wallet'.
	icon: { type: String, default: '' },
	sizeClass: { type: String, default: 'size-4' },
});

// Anything missing or not a lucide class would render as an empty box, since
// Tailwind only emits classes it found as literals at build time.
const iconClass = computed(() =>
	props.icon && props.icon.startsWith('lucide-') ? props.icon : 'lucide-hash',
);
</script>
