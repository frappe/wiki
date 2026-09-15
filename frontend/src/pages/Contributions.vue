<template>
	<div class="flex flex-col h-full overflow-hidden">
		<!-- Header renders into the shell's PageHeaderTarget. -->
		<PageHeaderMobile v-if="isMobile" :title="__('Change Requests')">
			<template #suffix>
				<MobileAppMenu />
			</template>
		</PageHeaderMobile>
		<PageHeader v-else>
			<h2 class="text-lg-semibold text-ink-gray-9">{{ __('Change Requests') }}</h2>
		</PageHeader>

		<!-- Mobile: a tab strip is cramped at 375px, so switch tabs with a select. -->
		<template v-if="isMobile">
			<div class="px-3 pt-3 pb-3 shrink-0">
				<FormControl
					type="select"
					:options="tabSelectOptions"
					v-model="activeTabKey"
				/>
			</div>
			<ContributionsPanel
				:resource="panelFor(activeKey).resource"
				:options="panelFor(activeKey).options"
				:show-assign="panelFor(activeKey).showAssign"
				@assign="openAssign"
			/>
		</template>

		<!-- Composed rather than the `:tabs` shorthand: the panel has to be a
		     constrained flex column for ContributionsPanel's `flex-1
		     overflow-auto` to scroll, and the shorthand's generated panels take
		     no classes. v1 ships no layout defaults of its own. -->
		<Tabs v-else v-model="activeTabKey" class="flex min-h-0 flex-1 flex-col">
			<!-- The pill track hugs its content, so page padding goes on a wrapper
			     rather than on TabList itself. -->
			<div class="shrink-0 px-3 pt-3 sm:px-5">
				<div class="flex items-center justify-between gap-3">
					<TabList variant="subtle" class="overflow-x-auto">
						<TabTrigger
							v-for="tab in tabs"
							:key="tab.key"
							:value="tab.key"
							:label="tab.label"
						/>
					</TabList>
					<!-- Loaded, not total: the list resource pages and reports no count,
					     so a bare number would go stale at the page boundary. The `+`
					     says there is more behind Load more. -->
					<span
						v-if="activeCountLabel"
						class="shrink-0 text-sm text-ink-gray-5"
					>
						{{ activeCountLabel }}
					</span>
				</div>
			</div>
			<!-- `display` is applied only while active. reka keeps an inactive
			     panel's wrapper in the DOM with a `hidden` attribute and drops
			     just its content; a bare `flex` here outranks Tailwind's
			     preflight `[hidden]{display:none}` (same specificity, utilities
			     come later), so all three panels stayed visible and split the
			     height three ways. -->
			<TabPanel
				v-for="tab in tabs"
				:key="tab.key"
				:value="tab.key"
				class="min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
			>
				<ContributionsPanel
					:resource="panelFor(tab.key).resource"
					:options="panelFor(tab.key).options"
					:show-assign="panelFor(tab.key).showAssign"
					@assign="openAssign"
				/>
			</TabPanel>
		</Tabs>

		<AssignDialog
			v-if="assignTarget"
			v-model="showAssignDialog"
			:change-request-id="assignTarget"
			@assigned="onAssigned"
		/>
	</div>
</template>

<script setup>
import AssignDialog from '@/components/AssignDialog.vue';
import ContributionsPanel from '@/components/ContributionsPanel.vue';
import MobileAppMenu from '@/components/MobileAppMenu.vue';
import { useMobile } from '@/composables/useMobile';
import { useUserStore } from '@/stores/user';
import { useRouteQuery } from '@vueuse/router';
import {
	FormControl,
	PageHeader,
	PageHeaderMobile,
	TabList,
	TabPanel,
	TabTrigger,
	Tabs,
	createListResource,
	usePageMeta,
} from 'frappe-ui';
import { computed, ref, watch } from 'vue';

const { isMobile } = useMobile();

usePageMeta(() => ({ title: `${__('Change Requests')} | Frappe Wiki` }));

const tabQuery = useRouteQuery('tab', 'my');
const userStore = useUserStore();
const isManager = computed(() => userStore.isWikiManager);
const currentUser = computed(() => userStore.data?.name);

// One field list for every tab: the panel renders a single feed row shape, and
// grouping by space means each row also has to carry the identity fields the
// group header draws its tile from. `wiki_space` (the link id) is needed both
// for the row route into the space editor and as the group key --
// `wiki_space.space_name` only yields the display name.
const CHANGE_REQUEST_FIELDS = [
	'name',
	'title',
	'status',
	'owner',
	'modified',
	'_assign',
	'archived_at',
	'merged_at',
	'wiki_space',
	'wiki_space.space_name',
	'wiki_space.space_icon',
	'wiki_space.space_color',
	'wiki_space.avatar',
	'wiki_space.app_switcher_logo',
];

const reviewRowRoute = (row) => ({
	name: 'ChangeRequestReview',
	params: { changeRequestId: row.name },
});

function getRowRoute(row) {
	if (row.status === 'Draft' || row.status === 'Changes Requested') {
		return { name: 'SpaceDetails', params: { spaceId: row.wiki_space } };
	}
	return { name: 'ChangeRequestReview', params: { changeRequestId: row.name } };
}

function listOptions(emptyState, rowRoute) {
	return {
		getRowRoute: rowRoute,
		emptyState,
	};
}

// Each tab is a self-contained descriptor: the server-side filter, its empty
// state, and whether its rows carry the assign action. `filters` is a getter (not a frozen object)
// so the session user is read at fetch time and can never leak in as
// `undefined` — the bug this tab structure previously shipped with.
const tabDefs = computed(() => {
	const defs = [
		{
			key: 'my',
			label: __('My Change Requests'),
			filters: () => ({ owner: ['=', currentUser.value] }),
			options: listOptions(
				{
					title: __('No Change Requests'),
					description: __(
						'You have not created any change requests yet. Edit a wiki page to get started.',
					),
				},
				getRowRoute,
			),
		},
		{
			key: 'assigned',
			label: __('Assigned to me'),
			showAssign: true,
			filters: () => ({
				_assign: ['like', `%${currentUser.value}%`],
				status: ['in', ['In Review', 'Approved']],
			}),
			options: listOptions(
				{
					title: __('Nothing assigned to you'),
					description: __(
						'Change requests assigned to you for review will appear here.',
					),
				},
				reviewRowRoute,
			),
		},
	];
	if (isManager.value) {
		defs.push({
			key: 'all',
			label: __('All in review'),
			showAssign: true,
			filters: () => ({ status: ['in', ['In Review', 'Approved']] }),
			options: listOptions(
				{
					title: __('No change requests in review'),
					description: __('There are no change requests waiting for review.'),
				},
				reviewRowRoute,
			),
		});
	}
	return defs;
});

const tabs = computed(() =>
	tabDefs.value.map((d) => ({ key: d.key, label: d.label })),
);

// A tab query naming a tab this user cannot see falls back to the first one.
const activeKey = computed(() => {
	const known = tabs.value.some((t) => t.key === tabQuery.value);
	return known ? tabQuery.value : tabs.value[0]?.key;
});

// Mobile select mirrors the desktop tab strip; both drive `tabQuery`.
const tabSelectOptions = computed(() =>
	tabs.value.map((t) => ({ label: t.label, value: t.key })),
);
const activeTabKey = computed({
	get: () => activeKey.value,
	set: (key) => {
		if (key) tabQuery.value = key;
	},
});

// One list resource per tab, built lazily on first access. The resource `auto`
// flag is evaluated once at creation (not reactive), so fetching is driven
// explicitly by the watcher below rather than by `auto`.
const resources = {};

function entryFor(key) {
	const def = tabDefs.value.find((d) => d.key === key);
	if (!def) return null;
	if (!resources[key]) {
		resources[key] = createListResource({
			doctype: 'Wiki Change Request',
			fields: CHANGE_REQUEST_FIELDS,
			filters: def.filters(),
			orderBy: 'modified desc',
			pageLength: 25,
			auto: false,
		});
	}
	return { def, resource: resources[key] };
}

// Lazy load: fetch a tab's list only the first time it becomes active, and
// re-apply its filter at fetch time so the current user is always fresh.
watch(
	activeKey,
	(key) => {
		const entry = key ? entryFor(key) : null;
		if (entry && !entry.resource.list.fetched) {
			entry.resource.update({ filters: entry.def.filters() });
			entry.resource.reload();
		}
	},
	{ immediate: true },
);

// Loaded rows, not a total: the list resource pages and reports no count.
const activeCountLabel = computed(() => {
	const entry = activeKey.value ? entryFor(activeKey.value) : null;
	if (!entry?.resource.list.fetched) return '';
	const loaded = entry.resource.data?.length || 0;
	if (!loaded) return '';
	if (loaded === 1 && !entry.resource.hasNextPage) {
		return __('1 change request');
	}
	const count = entry.resource.hasNextPage ? `${loaded}+` : `${loaded}`;
	return __('{0} change requests', [count]);
});

function panelFor(key) {
	const entry = entryFor(key) || entryFor(tabDefs.value[0].key);
	return {
		resource: entry.resource,
		options: entry.def.options,
		showAssign: Boolean(entry.def.showAssign),
	};
}

const showAssignDialog = ref(false);
const assignTarget = ref(null);

function openAssign(row) {
	assignTarget.value = row.name;
	showAssignDialog.value = true;
}

function onAssigned() {
	// Refresh only the inboxes that have actually been opened (and thus exist).
	resources['assigned']?.reload();
	resources['all']?.reload();
}
</script>
