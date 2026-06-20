<template>
	<div
		v-if="users.length"
		class="flex items-center"
		:class="users.length > 1 ? 'flex-row-reverse' : ''"
		data-testid="assignee-avatars"
	>
		<Tooltip v-if="users.length === 1" :text="users[0]">
			<Avatar shape="circle" :label="users[0]" :size="size" />
		</Tooltip>
		<Tooltip v-else v-for="user in reversedUsers" :key="user" :text="user">
			<Avatar
				class="-mr-1.5 transform ring-2 ring-outline-white transition hover:z-10 hover:scale-110"
				shape="circle"
				:label="user"
				:size="size"
			/>
		</Tooltip>
	</div>
</template>

<script setup>
import { computed } from 'vue';
import { Avatar, Tooltip } from 'frappe-ui';

const props = defineProps({
	// Frappe's native `_assign` field — a JSON-encoded array of user ids.
	assign: { type: [String, Array], default: '' },
	size: { type: String, default: 'sm' },
});

const users = computed(() => {
	if (Array.isArray(props.assign)) return props.assign;
	if (!props.assign) return [];
	try {
		const parsed = JSON.parse(props.assign);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
});

// Reversed + flex-row-reverse keeps the first assignee on top while preserving
// left-to-right reading order (mirrors Frappe CRM's MultipleAvatar).
const reversedUsers = computed(() => [...users.value].reverse());
</script>
