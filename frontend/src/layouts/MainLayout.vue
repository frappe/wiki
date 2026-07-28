<template>
	<div class="h-screen w-full bg-surface-sidebar">
		<template v-if="isLoading"></template>
		<template v-else-if="hasAccess">
			<MobileShell v-if="isMobile" class="wiki-mobile-shell">
				<slot></slot>

				<template #nav>
					<MobileNav>
						<MobileNavItem
							:label="__('Spaces')"
							:to="{ name: 'SpaceList' }"
							:active="isSpacesRoute"
						>
							<template #default="{ active }">
								<span
									class="lucide-rocket size-6"
									:class="active ? 'text-ink-gray-8' : 'text-ink-gray-5'" aria-hidden="true" />
							</template>
						</MobileNavItem>
						<MobileNavItem
							:label="__('Change Requests')"
							:to="{ name: 'ChangeRequests' }"
							:active="route.name === 'ChangeRequests'"
						>
							<template #default="{ active }">
								<span
									class="lucide-git-branch size-6"
									:class="active ? 'text-ink-gray-8' : 'text-ink-gray-5'" aria-hidden="true" />
							</template>
						</MobileNavItem>
					</MobileNav>
				</template>
			</MobileShell>
			<DesktopShell v-else class="wiki-desktop-shell h-full">
				<template #sidebar>
					<Sidebar />
				</template>
				<slot></slot>
			</DesktopShell>
		</template>
		<div
			v-else
			class="flex h-full items-center justify-center bg-surface-gray-1"
		>
			<div class="text-center">
				<div class="text-ink-gray-4 mb-4">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-16 w-16 mx-auto"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
						/>
					</svg>
				</div>
				<h2 class="text-xl-semibold text-ink-gray-8 mb-2">
					{{ __('Access Denied') }}
				</h2>
				<p class="text-ink-gray-6">
					{{ __("You don't have permission to access the Wiki.") }}
				</p>
				<p class="text-ink-gray-5 text-sm mt-1">
					{{ __('Please contact your administrator to request access.') }}
				</p>
			</div>
		</div>

		<WikiSettings v-model="showWikiSettings" :initial-tab="initialTab" />
	</div>
</template>

<script setup>
import { useUserStore } from '@/stores/user';
import { DesktopShell, MobileNav, MobileNavItem, MobileShell } from 'frappe-ui';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Sidebar from '../components/Sidebar.vue';
import WikiSettings from '../components/WikiSettings/WikiSettings.vue';
import { useMobile } from '../composables/useMobile';
import { useTheme } from '../composables/useTheme';
import { useWikiSettings } from '../composables/useWikiSettings';

const { isMobile } = useMobile();
const userStore = useUserStore();
const route = useRoute();
const router = useRouter();
const { showWikiSettings, initialTab, open } = useWikiSettings();
const { initTheme } = useTheme();

const isLoading = computed(() => userStore.isLoading);
const hasAccess = computed(() => userStore.canAccessWiki);

// Spaces stays lit across every space route (list + space details).
const isSpacesRoute = computed(() => route.path.startsWith('/spaces'));

// Theme is applied here (the one always-mounted component) so both the
// desktop and mobile shells get it.
onMounted(() => {
	initTheme();
});

// The GitHub-App manifest flow redirects back here with ?github_app_created=1.
// Re-open the settings dialog on the GitHub tab and strip the query param. This
// watches (rather than runs once on mount) because the app mounts before the
// router resolves the initial route, so the query isn't populated yet at mount.
watch(
	() => route.query.github_app_created,
	(created) => {
		if (!created) return;
		open('github');
		const query = { ...route.query };
		delete query.github_app_created;
		router.replace({ query });
	},
	{ immediate: true },
);
</script>

<style scoped>
/* Gameplan-style shell: the content column floats as a rounded card over the
   sidebar surface in light mode; flat with a hairline divider in dark. */
.wiki-desktop-shell :deep([data-slot='desktop-shell-content']) {
	margin: 0.25rem 0.25rem 0.25rem 0;
	border-radius: var(--radius-lg);
	background-color: var(--surface-base);
	box-shadow: var(--shadow-sm);
	overflow: hidden;
}
[data-theme='dark'] .wiki-desktop-shell :deep([data-slot='desktop-shell-content']) {
	margin: 0;
	border-radius: 0;
	border-left: 1px solid var(--outline-gray-2);
	box-shadow: none;
}

/* Wiki pages are app-like (columns + their own scroll regions), so they need
   the full height of the shell's scroll viewport. reka's ScrollArea wraps the
   slot in an unstyled display:table div that breaks h-full chains — give it
   full height explicitly. */
.wiki-desktop-shell :deep([data-reka-scroll-area-viewport]),
.wiki-desktop-shell :deep([data-reka-scroll-area-viewport] > div) {
	height: 100%;
}
.wiki-mobile-shell :deep([data-slot='mobile-shell-scroll']) > * {
	height: 100%;
}
</style>
