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
					:to="item.to"
					:active="item.routeNames.includes(route.name)"
					:suffix="item.suffix?.value"
				/>

				<SidebarSection :label="__('Spaces')">
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
									<SpaceAvatar
										:space="space"
										:label="space.space_name || space.name"
										size="sm"
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
						{{ __('No Wiki Spaces') }}
					</p>

					<!-- Most wikis hold a dozen spaces and fit here whole. When one
					     does not, the column stays short and hands the rest to the
					     Overview, which is the full directory with its own search. -->
					<SidebarItem
						v-if="spaces.hasNextPage"
						:label="__('Show all spaces')"
						icon="lucide-ellipsis"
						:to="{ name: 'Overview' }"
					/>
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

const showCreateDialog = ref(false);

// The sidebar is a nav column, not a directory: it lists what fits at a glance
// and defers the long tail to the Overview.
const SIDEBAR_LIMIT = 15;

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
