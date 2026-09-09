<template>
	<div class="divide-y divide-outline-gray-1">
		<SettingsRow
			:title="__('Show in Space Switcher')"
			:description="
				__('List this space in the switcher and on the overview page')
			"
		>
			<Switch
				v-model="showInSwitcher"
				:disabled="savingSwitcher"
				@update:modelValue="updateShowInSwitcher"
			/>
		</SettingsRow>

		<SettingsRow
			:title="__('Order')"
			:description="
				__('Lower numbers come first; spaces that tie are ordered by name')
			"
		>
			<FormControl
				v-model="switcherOrder"
				class="w-20"
				type="number"
				:disabled="savingOrder"
				@blur="updateSwitcherOrder"
				@keydown.enter="$event.target.blur()"
			/>
		</SettingsRow>
	</div>
</template>

<script setup>
import { FormControl, SettingsRow, Switch, toast } from 'frappe-ui';
import { ref, watch } from 'vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
});

const showInSwitcher = ref(true);
const switcherOrder = ref(0);
const savingSwitcher = ref(false);
const savingOrder = ref(false);

watch(
	() => props.space.doc,
	(doc) => {
		if (!doc) return;
		showInSwitcher.value = Boolean(doc.show_in_switcher);
		switcherOrder.value = doc.switcher_order ?? 0;
	},
	{ immediate: true },
);

async function updateShowInSwitcher(value) {
	savingSwitcher.value = true;
	try {
		await props.space.setValue.submit({ show_in_switcher: value ? 1 : 0 });
	} catch (error) {
		showInSwitcher.value = !value;
		toast.error(error.messages?.[0] || __('Failed to update the switcher'));
	} finally {
		savingSwitcher.value = false;
	}
}

// The field is a number input, so an emptied box reads as 0 rather than as a
// request to unset the order.
async function updateSwitcherOrder() {
	const saved = props.space.doc?.switcher_order ?? 0;
	const next = Number(switcherOrder.value) || 0;
	if (next === saved) {
		switcherOrder.value = saved;
		return;
	}
	savingOrder.value = true;
	try {
		await props.space.setValue.submit({ switcher_order: next });
		switcherOrder.value = next;
	} catch (error) {
		switcherOrder.value = saved;
		toast.error(error.messages?.[0] || __('Failed to update the order'));
	} finally {
		savingOrder.value = false;
	}
}
</script>
