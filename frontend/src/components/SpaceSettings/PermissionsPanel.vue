<template>
	<div class="flex flex-col gap-4">
		<!-- Add role, above the table. The dropdown is rendered in-flow (no
		     teleport) so it stays clickable inside the modal dialog. Pick a role
		     to fill the field, then Add it to the table. -->
		<div
			v-if="canManageAccess"
			class="flex items-end gap-2"
			@focusin="openRoleList"
			@focusout="closeRoleListSoon"
			@keyup.enter="addRole"
		>
			<div class="relative flex-1" @input="showRoleList = true">
				<FormControl
					type="text"
					:placeholder="__('Search role to add')"
					v-model="roleQuery"
				/>
				<div
					v-if="showRoleList"
					class="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-outline-gray-2 bg-surface-modal p-1 shadow-lg"
				>
					<div
						v-if="allRoles.loading"
						class="px-2.5 py-1.5 text-base text-ink-gray-5"
					>
						{{ __('Loading…') }}
					</div>
					<template v-else>
						<button
							v-for="role in filteredRoleOptions"
							:key="role"
							type="button"
							class="block w-full truncate rounded px-2.5 py-1.5 text-left text-base text-ink-gray-7 hover:bg-surface-gray-3"
							@mousedown.prevent
							@click="pickRole(role)"
						>
							{{ role }}
						</button>
						<div
							v-if="!filteredRoleOptions.length"
							class="px-2.5 py-1.5 text-base text-ink-gray-5"
						>
							{{ __('No roles found') }}
						</div>
					</template>
				</div>
			</div>
			<Button variant="subtle" :disabled="!matchedRole" @click="addRole">
				{{ __('Add') }}
			</Button>
		</div>

		<!-- Roles table -->
		<div class="overflow-hidden rounded-lg border border-outline-gray-2">
			<table class="w-full table-fixed text-sm">
				<thead>
					<tr class="bg-surface-gray-2 text-ink-gray-5">
						<th class="px-3 py-2 text-left font-medium">{{ __('Role') }}</th>
						<th class="w-32 px-3 py-2 text-left font-medium">{{ __('Access') }}</th>
						<th class="w-12 px-3 py-2"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-outline-gray-2">
					<tr
						v-for="(row, idx) in roleRows"
						:key="row.role"
						class="group hover:bg-surface-gray-1"
					>
						<td class="truncate px-3 py-2.5 text-ink-gray-8">{{ row.role }}</td>
						<td class="px-3 py-2.5">
							<Select
								v-if="canManageAccess"
								size="sm"
								:options="['Read', 'Write']"
								:modelValue="row.permission_level"
								@update:modelValue="(val) => setPermissionLevel(idx, val)"
							/>
							<Badge
								v-else
								size="sm"
								:theme="row.permission_level === 'Write' ? 'green' : 'gray'"
							>
								{{ row.permission_level }}
							</Badge>
						</td>
						<td class="px-3 py-2.5 text-right">
							<Button
								v-if="canManageAccess"
								class="invisible group-hover:visible"
								variant="ghost"
								theme="red"
								size="sm"
								icon="trash-2"
								@click="removeRole(idx)"
							/>
						</td>
					</tr>
					<tr v-if="!roleRows.length">
						<td
							colspan="3"
							class="px-3 py-6 text-center text-xs text-ink-gray-5"
						>
							{{ __('No roles configured (open to all logged-in users).') }}
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<!-- Helper message, below the table -->
		<p class="text-xs text-ink-gray-5">
			{{ __('Readable by all logged-in users if no roles are set. Add the Guest role for public/anonymous access.') }}
		</p>
		<p v-if="!canManageAccess" class="text-xs text-ink-gray-5">
			{{ __('Only space admins can change access control.') }}
		</p>

		<!-- Primary Save, below the message, aligned right -->
		<div v-if="canManageAccess" class="flex justify-end">
			<Button
				variant="solid"
				size="sm"
				:disabled="!isDirty"
				:loading="savingRoles"
				@click="saveRoles"
			>
				{{ __('Save') }}
			</Button>
		</div>
	</div>
</template>

<script setup>
import {
	Badge,
	Button,
	FormControl,
	Select,
	createListResource,
	createResource,
	toast,
} from 'frappe-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
	space: {
		type: Object,
		required: true,
	},
	spaceId: {
		type: String,
		required: true,
	},
});

const emit = defineEmits(['update:dirty']);

const roleRows = ref([]);
const savedRoles = ref([]);
const savingRoles = ref(false);

// Inline (non-teleported) role picker state — see template note.
const roleQuery = ref('');
const showRoleList = ref(false);
let roleListBlurTimer = null;

// Only users who can write the space may edit its access control (mirrors the
// server-side check in update_space_roles). Read-tier users see it read-only.
const canManageAccess = ref(false);
const spaceCapabilities = createResource({
	url: 'wiki.api.get_space_capabilities',
	onSuccess: (data) => {
		canManageAccess.value = Boolean(data?.can_write);
	},
});

function snapshot(rows) {
	return rows.map((row) => ({
		role: row.role,
		permission_level: row.permission_level,
	}));
}

watch(
	() => props.space.doc,
	(doc) => {
		if (doc) {
			roleRows.value = snapshot(doc.roles || []);
			savedRoles.value = snapshot(doc.roles || []);
			spaceCapabilities.submit({ space: props.spaceId });
		}
	},
	{ immediate: true },
);

// Stable serialization so row order doesn't register as a change.
function serialize(rows) {
	return JSON.stringify(
		[...rows].sort((a, b) => a.role.localeCompare(b.role)),
	);
}

const isDirty = computed(
	() => serialize(roleRows.value) !== serialize(savedRoles.value),
);

watch(isDirty, (dirty) => emit('update:dirty', dirty), { immediate: true });

const allRoles = createListResource({
	doctype: 'Role',
	fields: ['name'],
	filters: [['disabled', '=', 0]],
	pageLength: 0,
	auto: true,
});
const roleOptions = computed(() => {
	const taken = new Set(roleRows.value.map((r) => r.role));
	return (allRoles.data || [])
		.map((r) => r.name)
		.filter((name) => !taken.has(name))
		.sort();
});

const filteredRoleOptions = computed(() => {
	const query = roleQuery.value.trim().toLowerCase();
	const matches = query
		? roleOptions.value.filter((name) => name.toLowerCase().includes(query))
		: roleOptions.value;
	return matches.slice(0, 50);
});

function openRoleList() {
	clearTimeout(roleListBlurTimer);
	showRoleList.value = true;
}

function closeRoleListSoon() {
	roleListBlurTimer = setTimeout(() => {
		showRoleList.value = false;
	}, 150);
}

// Exact, still-available role currently in the field — gates the Add button.
const matchedRole = computed(
	() => roleOptions.value.find((name) => name === roleQuery.value.trim()) || null,
);

function pickRole(role) {
	roleQuery.value = role;
	showRoleList.value = false;
}

function addRole() {
	const role = matchedRole.value;
	if (!role) return;
	roleRows.value.push({ role, permission_level: 'Read' });
	roleQuery.value = '';
	showRoleList.value = false;
}

onBeforeUnmount(() => clearTimeout(roleListBlurTimer));

function setPermissionLevel(idx, level) {
	roleRows.value[idx].permission_level = level;
}

function removeRole(idx) {
	roleRows.value.splice(idx, 1);
}

const updateRolesResource = createResource({
	url: 'wiki.api.wiki_space.update_space_roles',
});

async function saveRoles() {
	savingRoles.value = true;
	try {
		await updateRolesResource.submit({
			space_id: props.spaceId,
			roles: roleRows.value,
		});
		await props.space.reload();
		toast.success(__('Access control updated'));
	} catch (error) {
		toast.error(error.messages?.[0] || __('Failed to update access control'));
	} finally {
		savingRoles.value = false;
	}
}
</script>
