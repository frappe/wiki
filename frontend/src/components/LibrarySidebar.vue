<template>
	<!-- Level 0 of the drill-in model: the wiki's library. Entering a space
	     replaces this whole column with SpaceSidebar, so this is the only place
	     that lists what a wiki contains.

	     SidebarHeader owns its own gutter and a fixed 48px height that lines up
	     with PageHeader, so it goes straight into Sidebar. Padding belongs on the
	     scroll region and the footer instead. -->
	<Sidebar>
		<SidebarHeader
			:title="__('Frappe Wiki')"
			:subtitle="userStore.data?.full_name"
			logo="/assets/wiki/images/wiki-logo.png"
			:menu-items="headerMenuItems"
		/>
		<ScrollArea class="min-h-0 flex-1" viewport-class="px-2 pt-1">
			<div class="flex flex-col gap-0.5">
				<SidebarItem
					v-for="item in navItems"
					:key="item.label"
					:label="item.label"
					:icon="item.icon"
					:route="item.to"
					:active="item.routeNames.includes(route.name)"
					:suffix="item.suffix?.value"
				/>
				<SidebarItem
					:label="__('Search')"
					icon="lucide-search"
					@click="openCommandPalette('click')"
				>
					<template #suffix>
						<KeyboardShortcut combo="Mod+K" class="mr-2 text-ink-gray-4" />
					</template>
				</SidebarItem>

				<SidebarSection
					v-for="group in spaceGroups"
					:key="group.key"
					:label="group.label"
					:collapsible="group.key === 'unpublished'"
					:collapsed="group.key === 'unpublished' && unpublishedCollapsed"
					@update:collapsed="unpublishedCollapsed = $event"
				>
					<ContextMenu :options="spaceMenu">
						<div class="flex flex-col gap-0.5">
							<SidebarItem
								v-for="space in group.spaces"
								:key="space.name"
								:label="space.space_name || space.name"
								:route="{ name: 'SpaceDetails', params: { spaceId: space.name } }"
								@contextmenu="openSpaceMenu(space)"
							>
								<template #prefix>
									<SpaceAvatar
										:space="space"
										:label="space.space_name || space.name"
										size="sm"
									/>
								</template>
								<!-- No unpublished icon: the Unpublished section already says it. -->
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
									</span>
								</template>
							</SidebarItem>
						</div>
					</ContextMenu>

					<p
						v-if="group.key === 'published' && !spaces.loading && !orderedSpaces.length"
						class="px-2 py-2 text-p-sm text-ink-gray-5"
					>
						{{ __('No Wiki Spaces') }}
					</p>

				</SidebarSection>
			</div>
		</ScrollArea>
		<div
			v-if="userStore.isWikiManager"
			class="flex flex-col gap-1 border-t border-outline-gray-2 p-2"
		>
			<Button
				class="w-full"
				variant="subtle"
				:label="__('New Space')"
				@click="showCreateDialog = true"
			>
				<template #prefix>
					<span class="lucide-plus size-4" aria-hidden="true" />
				</template>
			</Button>
		</div>
	</Sidebar>

	<NewSpaceDialog v-model="showCreateDialog" @created="spaces.reload()" />
</template>

<script setup>
import {
	Button,
	ContextMenu,
	KeyboardShortcut,
	ScrollArea,
	Sidebar,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	Tooltip,
	createResource,
	toast,
} from 'frappe-ui';

import NewSpaceDialog from '@/components/NewSpaceDialog.vue';
import SpaceAvatar from '@/components/SpaceAvatar.vue';
import { useSessionStore } from '@/stores/session';
import { useUserStore } from '@/stores/user';
import { useStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCommandPalette } from '../composables/useCommandPalette';
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
const { open: openCommandPalette } = useCommandPalette();

const { themeIcon, toggleTheme } = useTheme();

const showCreateDialog = ref(false);

// The sidebar is a nav column, not a directory: it lists what fits at a glance
// and defers the long tail to All Spaces. Which spaces make the cut is decided
// by the recency order the composable now applies for both surfaces.
const SIDEBAR_LIMIT = 100;

const { spaces, orderedSpaces, restrictedSpaces, isPinned, togglePin } =
	useSpaceLibrary({
		limit: SIDEBAR_LIMIT,
		// A manager's own unpublished drafts have to stay in the column they work
		// in; for everyone else an unpublished space is not part of the wiki yet.
		publishedOnly: computed(() => !userStore.isWikiManager),
	});

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

const unpublishedCollapsed = useStorage(
	'wiki:sidebar-unpublished-collapsed',
	true,
);

const spaceGroups = computed(() => {
	const published = orderedSpaces.value.filter((space) => space.is_published);
	const unpublished = orderedSpaces.value.filter(
		(space) => !space.is_published,
	);
	return [
		{ key: 'published', label: __('Spaces'), spaces: published },
		{ key: 'unpublished', label: __('Unpublished'), spaces: unpublished },
	].filter(
		(group) =>
			group.spaces.length || (group.key === 'published' && !unpublished.length),
	);
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

const openChangeRequestCount = computed(() =>
	openChangeRequests.data ? String(openChangeRequests.data) : '',
);

const navItems = computed(() => [
	...(userStore.isWikiManager
		? [
				{
					label: __('Overview'),
					icon: 'lucide-layout-grid',
					to: { name: 'Overview' },
					routeNames: ['Overview'],
				},
			]
		: []),
	{
		label: __('All Spaces'),
		icon: 'lucide-library',
		to: { name: 'AllSpaces' },
		routeNames: ['AllSpaces'],
	},
	{
		label: __('Change Requests'),
		icon: 'lucide-git-branch',
		to: { name: 'ChangeRequests' },
		routeNames: ['ChangeRequests', 'ChangeRequestReview'],
		suffix: openChangeRequestCount,
	},
]);

function logout() {
	sessionStore.logout.submit();
}
</script>
