<template>
	<!-- A change request in review has no submit step: edits land as they save,
	     so this only leaves the editor and goes back to the review. -->
	<Button
		v-if="spaceStore.isEditingInReview"
		variant="solid"
		:loading="finishing"
		@click="finish"
	>
		{{ __('Save') }}
	</Button>
</template>

<script setup>
import { Button } from 'frappe-ui';
import { ref } from 'vue';
import { useChangeRequestActions } from '../composables/useChangeRequestActions';
import { useSpaceStore } from '../stores/space';

const spaceStore = useSpaceStore();
const crActions = useChangeRequestActions();
const finishing = ref(false);

async function finish() {
	finishing.value = true;
	try {
		await crActions.finishEditingInReview();
	} finally {
		finishing.value = false;
	}
}
</script>
