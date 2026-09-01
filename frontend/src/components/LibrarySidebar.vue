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
			/>

			<SidebarSection :label="__('Spaces')">
				<SidebarItem
					v-for="space in spaces.data || []"
					:key="space.name"
					:label="space.space_name || space.name"
					:to="{ name: 'SpaceDetails', params: { spaceId: space.name } }"
				>
					<template #prefix>
						<Avatar
							size="sm"
							shape="square"
							:image="space.app_switcher_logo"
							:label="space.space_name || space.name"
						/>
					</template>
				</SidebarItem>

				<!-- A wiki can hold thousands of spaces, so the list is paged rather
				     than fetched whole; search over it arrives with the library
				     affordances. -->
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
		<div class="px-2 pb-2">
			<SidebarCollapseToggle />
		</div>
	</Sidebar>
</template>

<script setup>
import {
	Avatar,
	Button,
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	useList,
} from 'frappe-ui';

import { useSessionStore } from '@/stores/session';
import { useUserStore } from '@/stores/user';
import { useStorage } from '@vueuse/core';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTheme } from '../composables/useTheme';
import { useWikiSettings } from '../composables/useWikiSettings';

const route = useRoute();
const sessionStore = useSessionStore();
const userStore = useUserStore();
const { open: openWikiSettings } = useWikiSettings();

const { themeIcon, toggleTheme } = useTheme();

const isSidebarCollapsed = useStorage('is-sidebar-collapsed', false);

// switcher_order is the space's declared position, but it defaults to 0 for
// every space, so the newest space would otherwise land in an arbitrary spot in
// the list. Creation order breaks the tie the way the old list page did.
const spaces = useList({
	doctype: 'Wiki Space',
	fields: [
		'name',
		'space_name',
		'route',
		'app_switcher_logo',
		'is_published',
		'git_synced',
		'switcher_order',
	],
	orderBy: 'switcher_order asc, creation desc',
	limit: 50,
});

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
	},
];

function logout() {
	sessionStore.logout.submit();
}
</script>
