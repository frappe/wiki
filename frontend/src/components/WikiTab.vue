<template>
	<div
		role="tab"
		:aria-selected="active"
		:aria-label="tab.title"
		:data-tab-key="tab.key"
		:title="tab.title"
		class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap py-2.5 text-base duration-300 ease-in-out"
		:class="[
			active ? 'text-ink-gray-9' : 'text-ink-gray-5 hover:text-ink-gray-9',
			draggable && !editing ? 'cursor-grab active:cursor-grabbing' : '',
		]"
		@click="!editing && emit('select')"
	>
		<!-- Icon opens the picker inline; falls back to a static icon when the
		     user can't manage tabs. -->
		<IconPicker
			v-if="canManage"
			:model-value="tab.icon"
			@update:model-value="emit('update-icon', $event)"
		>
			<template #default="{ togglePopover }">
				<button
					type="button"
					class="flex shrink-0 rounded hover:bg-surface-gray-3"
					:title="__('Change icon')"
					@click.stop="togglePopover()"
				>
					<SpaceIcon v-if="tab.icon" :icon="tab.icon" />
					<span v-else class="lucide-plus size-4 text-ink-gray-4" aria-hidden="true" />
				</button>
			</template>
		</IconPicker>
		<SpaceIcon v-else-if="tab.icon" :icon="tab.icon" class="shrink-0" />

		<!-- Double-click the label to rename. -->
		<input
			v-if="editing"
			ref="titleInput"
			v-model="draftTitle"
			class="min-w-0 bg-transparent p-0 text-base text-ink-gray-9 outline-none focus:ring-0"
			:size="Math.max(draftTitle.length, 1)"
			@click.stop
			@keydown.enter="commit"
			@keydown.esc="cancel"
			@blur="commit"
		/>
		<span v-else @dblclick.stop="canManage && startEdit()">{{ tab.title }}</span>

		<span
			v-if="active"
			class="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-surface-gray-10"
		/>
	</div>
</template>

<script setup>
import { nextTick, ref } from 'vue';
import IconPicker from './IconPicker.vue';
import SpaceIcon from './SpaceIcon.vue';

const props = defineProps({
	tab: { type: Object, required: true },
	active: { type: Boolean, default: false },
	canManage: { type: Boolean, default: false },
	draggable: { type: Boolean, default: false },
});

const emit = defineEmits(['select', 'update-icon', 'rename']);

const editing = ref(false);
const draftTitle = ref('');
const titleInput = ref(null);

async function startEdit() {
	draftTitle.value = props.tab.title;
	editing.value = true;
	await nextTick();
	titleInput.value?.focus();
	titleInput.value?.select();
}

function commit() {
	if (!editing.value) return;
	editing.value = false;
	const next = draftTitle.value.trim();
	if (next && next !== props.tab.title) emit('rename', next);
}

function cancel() {
	editing.value = false;
}
</script>
