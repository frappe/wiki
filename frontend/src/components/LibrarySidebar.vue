<template>
	<!-- Level 0 of the drill-in model: the wiki's library. Entering a space
	     replaces this whole column with SpaceSidebar, so this is the only place
	     that lists what a wiki contains.

	     SidebarHeader owns its own gutter and a fixed 48px height that lines up
	     with PageHeader, so it goes straight into Sidebar. Padding belongs on the
	     scroll region and the footer instead. -->
	<Sidebar v-model:collapsed="isSidebarCollapsed">
		<SidebarHeader
			:title="__('Frappe Wiki')"
			:subtitle="userStore.data?.full_name"
			logo="/assets/wiki/images/wiki-logo.png"
			:menu-items="headerMenuItems"
		/>
		<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1">
			<SidebarItem
				v-for="item in navItems"
				:key="item.label"
				:label="item.label"
				:icon="item.icon"
				:to="item.to"
				:active="item.routeNames.includes(route.name)"
				:suffix="item.suffix?.value"
			/>

			<SidebarSection :label="__('Spaces')">
				<!-- The list page that used to own space search is gone, and a wiki
				     can hold thousands of spaces, so the filter lives here now. It
				     runs server-side over the same paged list. -->
				<TextInput
					v-if="showSearch"
					class="mb-1"
					size="sm"
					type="text"
					v-model="searchQuery"
					:placeholder="__('Search spaces...')"
				>
					<template #prefix>
						<span class="lucide-search size-4 text-ink-gray-4" aria-hidden="true" />
					</template>
				</TextInput>

				<!-- One menu for the whole list: the row writes its own options as it
				     is right-clicked, before the menu opens, so there is no
				     ContextMenu instance per space. The trigger is `as-child`, so the
				     rows need the one wrapping root. -->
				<ContextMenu :options="spaceMenu">
					<div class="flex flex-col gap-0.5">
						<SidebarItem
							v-for="space in orderedSpaces"
							:key="space.name"
							:label="space.space_name || space.name"
							:to="{ name: 'SpaceDetails', params: { spaceId: space.name } }"
							@contextmenu="openSpaceMenu(space)"
						>
							<template #prefix>
								<Avatar
									size="sm"
									shape="square"
									:image="space.app_switcher_logo"
									:label="space.space_name || space.name"
								/>
							</template>
							<!-- Access and publish state are independent fields, so each
							     gets its own icon. One merged badge would hide the case
							     that matters most: a restricted space that is also
							     unpublished. -->
							<template #suffix>
								<span class="mr-2 flex items-center gap-1">
									<Tooltip v-if="isPinned(space.name)" :text="__('Pinned to top')">
										<span class="lucide-pin size-3.5 text-ink-gray-5" aria-hidden="true" />
									</Tooltip>
									<Tooltip v-if="space.git_synced" :text="__('Synced from GitHub')">
										<span class="lucide-folder-git-2 size-3.5 text-ink-gray-4" aria-hidden="true" />
									</Tooltip>
									<Tooltip v-if="restrictedSpaces.has(space.name)" :text="__('Restricted access')">
										<span class="lucide-lock size-3.5 text-ink-gray-4" aria-hidden="true" />
									</Tooltip>
									<Tooltip v-if="!space.is_published" :text="__('Unpublished')">
										<span class="lucide-eye-off size-3.5 text-ink-gray-4" aria-hidden="true" />
									</Tooltip>
								</span>
							</template>
						</SidebarItem>
					</div>
				</ContextMenu>

				<p
					v-if="!spaces.loading && !orderedSpaces.length"
					class="px-2 py-2 text-p-sm text-ink-gray-5"
				>
					{{ searchQuery ? __('No spaces found') : __('No Wiki Spaces') }}
				</p>

				<!-- A wiki can hold thousands of spaces, so the list is paged rather
				     than fetched whole. -->
				<Button
					v-if="spaces.hasNextPage"
					class="w-full"
					variant="ghost"
					:label="__('Load more')"
					:loading="spaces.loading"
					@click="spaces.next()"
				/>
			</SidebarSection>
		</div>
		<div class="flex flex-col gap-1 border-t border-outline-gray-2 p-2">
			<Button
				v-if="userStore.isWikiManager"
				class="w-full"
				variant="subtle"
				:label="__('New Space')"
				@click="showCreateDialog = true"
			>
				<template #prefix>
					<span class="lucide-plus size-4" aria-hidden="true" />
				</template>
			</Button>
			<SidebarCollapseToggle />
		</div>
	</Sidebar>

	<NewSpaceDialog v-model="showCreateDialog" @created="spaces.reload()" />
</template>

<script setup>
import {
	Avatar,
	Button,
	ContextMenu,
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	TextInput,
	Tooltip,
	createResource,
	toast,
} from 'frappe-ui';

import NewSpaceDialog from '@/components/NewSpaceDialog.vue';
import { useSessionStore } from '@/stores/session';
import { useUserStore } from '@/stores/user';
import { useStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSpaceLibrary } from '../composables/useSpaceLibrary';
import { useSpaceSettings } from '../composables/useSpaceSettings';
import { useTheme } from '../composables/useTheme';
import { useWikiSettings } from '../composables/useWikiSettings';

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();
const userStore = useUserStore();
const { open: openWikiSettings } = useWikiSettings();
const { open: openSpaceSettings } = useSpaceSettings();

const { themeIcon, toggleTheme } = useTheme();

const isSidebarCollapsed = useStorage('is-sidebar-collapsed', false);
const showCreateDialog = ref(false);

const {
	spaces,
	searchQuery,
	showSearch,
	orderedSpaces,
	restrictedSpaces,
	isPinned,
	togglePin,
} = useSpaceLibrary();

// Merged, rejected and archived requests are done, so they do not belong in
// the sidebar count. `get_count` runs through the same permission query as the
// list, so this is the user's own count, not the wiki's.
const openChangeRequests = createResource({
	url: 'frappe.client.get_count',
	params: {
		doctype: 'Wiki Change Request',
		filters: { status: ['not in', ['Merged', 'Rejected', 'Archived']] },
	},
	auto: true,
});

const spaceMenu = ref([]);

function openSpaceMenu(space) {
	const pinned = isPinned(space.name);
	spaceMenu.value = [
		{
			label: pinned ? __('Unpin from top') : __('Pin to top'),
			icon: pinned ? 'lucide-pin-off' : 'lucide-pin',
			onClick: () => pinSpace(space),
		},
		{
			label: __('Space settings'),
			icon: 'lucide-settings',
			onClick: () => goToSpaceSettings(space),
		},
		{
			label: __('Copy link'),
			icon: 'lucide-link',
			onClick: () => copySpaceLink(space),
		},
	];
}

function pinSpace(space) {
	const label = space.space_name || space.name;
	const pinned = togglePin(space.name);
	toast.success(
		pinned ? __('{0} pinned', [label]) : __('{0} unpinned', [label]),
	);
}

// The settings dialog is mounted by SpaceDetails, so opening it from the
// library means going there first.
async function goToSpaceSettings(space) {
	await router.push({
		name: 'SpaceDetails',
		params: { spaceId: space.name },
	});
	openSpaceSettings();
}

async function copySpaceLink(space) {
	const { href } = router.resolve({
		name: 'SpaceDetails',
		params: { spaceId: space.name },
	});
	await navigator.clipboard.writeText(`${window.location.origin}${href}`);
	toast.success(__('Link copied'));
}

const headerMenuItems = computed(() => [
	...(userStore.isWikiManager
		? [
				{
					label: __('Settings'),
					icon: 'lucide-settings',
					onClick: () => openWikiSettings(),
				},
			]
		: []),
	{ label: __('Toggle Theme'), icon: themeIcon.value, onClick: toggleTheme },
	{ label: __('Log out'), icon: 'lucide-log-out', onClick: logout },
]);

const navItems = [
	{
		label: __('Overview'),
		icon: 'lucide-layout-dashboard',
		to: { name: 'Overview' },
		routeNames: ['Overview'],
	},
	{
		label: __('Change Requests'),
		icon: 'lucide-git-branch',
		to: { name: 'ChangeRequests' },
		routeNames: ['ChangeRequests', 'ChangeRequestReview'],
		suffix: computed(() =>
			openChangeRequests.data ? String(openChangeRequests.data) : '',
		),
	},
];

function logout() {
	sessionStore.logout.submit();
}
</script>
