<template>
	<div class="flex flex-col gap-4">
		<!-- Add role, above the table. The list is searched on the server as you
		     type — a site can have far more roles than fit in one page, so a
		     client-side filter over the first page would hide most of them.
		     Pick a role to fill the field, then Add it to the table. -->
		<div v-if="canManageAccess" class="flex items-end gap-2">
			<!-- Combobox renders as `display: contents` when it has no label, so
			     the width has to come from a wrapper, not a class on it. -->
			<div class="flex-1">
				<Combobox
					ref="roleCombobox"
					v-model="selectedRole"
					:options="roleOptions"
					:placeholder="__('Search role to add')"
					:loading="rolesLoading"
					:empty-text="__('No roles found')"
					@update:query="searchRoles"
				/>
			</div>
			<Button variant="subtle" :disabled="!selectedRole" @click="addRole">
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

		<!-- Accept contributions -->
		<SettingsRow
			class="border-t border-outline-gray-1"
			:title="__('Accept Contributions')"
			:description="contributionsDescription"
		>
			<Switch
				v-model="allowContributions"
				:disabled="!canManageAccess || savingContributions || isGitSynced"
				@update:modelValue="updateContributions"
			/>
		</SettingsRow>

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
	Combobox,
	Select,
	SettingsRow,
	Switch,
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

// Legacy spaces (created before this toggle) have a null column; treat as on.
const allowContributions = ref(true);
const savingContributions = ref(false);
// Git-synced spaces are read-only; the toggle is moot and the server rejects it.
const isGitSynced = computed(() => Boolean(props.space.doc?.git_synced));

const contributionsDescription = computed(() => {
	const base = __(
		'Let readers propose edits via change requests. Users with write access can always edit.',
	);
	return isGitSynced.value
		? `${base} ${__('Synced spaces are read-only, so contributions are always off.')}`
		: base;
});

const roleCombobox = ref(null);
const selectedRole = ref(null);

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
			allowContributions.value =
				doc.allow_contributions == null
					? true
					: Boolean(doc.allow_contributions);
			spaceCapabilities.submit({ space: props.spaceId });
		}
	},
	{ immediate: true },
);

// Stable serialization so row order doesn't register as a change.
function serialize(rows) {
	return JSON.stringify([...rows].sort((a, b) => a.role.localeCompare(b.role)));
}

const isDirty = computed(
	() => serialize(roleRows.value) !== serialize(savedRoles.value),
);

watch(isDirty, (dirty) => emit('update:dirty', dirty), { immediate: true });

const ROLE_PAGE_LENGTH = 50;
const BASE_ROLE_FILTERS = [['disabled', '=', 0]];

const allRoles = createListResource({
	doctype: 'Role',
	fields: ['name'],
	filters: BASE_ROLE_FILTERS,
	orderBy: 'name asc',
	pageLength: ROLE_PAGE_LENGTH,
	auto: true,
});

const roleOptions = computed(() => {
	const taken = new Set(roleRows.value.map((r) => r.role));
	return (allRoles.data || [])
		.map((r) => r.name)
		.filter((name) => !taken.has(name))
		.map((name) => ({ label: name, value: name }));
});

// Combobox only filters the options it is handed, so the server has to be the
// one that widens the candidate set — otherwise the picker can never see past
// the first page of roles.
let roleSearchTimer = null;
const roleSearchPending = ref(false);
const rolesLoading = computed(
	() => roleSearchPending.value || allRoles.list.loading,
);

function searchRoles(query) {
	clearTimeout(roleSearchTimer);
	roleSearchPending.value = true;
	roleSearchTimer = setTimeout(() => {
		const term = query.trim();
		const filters = term
			? [...BASE_ROLE_FILTERS, ['name', 'like', `%${term}%`]]
			: [...BASE_ROLE_FILTERS];
		allRoles.update({ filters, start: 0 });
		allRoles.reload().finally(() => {
			roleSearchPending.value = false;
		});
	}, 300);
}

function addRole() {
	const role = selectedRole.value;
	if (!role) return;
	roleRows.value.push({ role, permission_level: 'Read' });
	// Combobox parks the picked label in its own input; reset() clears both the
	// query and the selection, and re-emits an empty query so the next open
	// starts from the unfiltered list.
	roleCombobox.value?.reset();
}

onBeforeUnmount(() => clearTimeout(roleSearchTimer));

function setPermissionLevel(idx, level) {
	roleRows.value[idx].permission_level = level;
}

function removeRole(idx) {
	roleRows.value.splice(idx, 1);
}

const updateRolesResource = createResource({
	url: 'wiki.api.wiki_space.update_space_roles',
});

const contributionsResource = createResource({
	url: 'wiki.api.wiki_space.set_space_contributions',
});

async function updateContributions(value) {
	savingContributions.value = true;
	try {
		await contributionsResource.submit({
			space_id: props.spaceId,
			allow: value ? 1 : 0,
		});
		toast.success(
			value ? __('Contributions enabled') : __('Contributions disabled'),
		);
	} catch (error) {
		allowContributions.value = !value;
		toast.error(
			error.messages?.[0] || __('Failed to update contributions setting'),
		);
	} finally {
		savingContributions.value = false;
	}
}

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
