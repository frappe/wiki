<template>
	<!-- Full-width chrome bar above the content column: state on the left,
	     contextual actions on the right. Shared by the change-request banner and
	     the git-sync banner so both surfaces get the same layout.

	     Space identity — name, back, settings, view live — belongs to the
	     sidebar now, which is the space, so this bar carries none of it. -->
	<div
		class="min-h-10 px-2 py-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
		:class="barClass"
	>
		<div class="flex min-w-0 items-center gap-2">
			<slot name="badge" />
			<slot name="meta" />
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup>
defineProps({
	// Colour/border classes for the bar surface (e.g. the CR status colour).
	barClass: {
		type: String,
		default: 'bg-surface-gray-1 border-b border-outline-gray-2 text-ink-gray-8',
	},
});
</script>
