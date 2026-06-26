<template>
	<header
		class="flex h-14 shrink-0 items-center gap-2 border-b border-outline-gray-2 bg-surface-white px-3"
		:style="{ paddingTop: 'env(safe-area-inset-top)' }"
	>
		<!-- Brand on the left (home). Hidden on pages that supply their own
		     leading control (e.g. the space tree toggle), so it shows only on
		     the list views. -->
		<button
			v-if="!mobileHasLeadingControl"
			class="flex size-11 shrink-0 items-center justify-center rounded"
			:title="__('Frappe Wiki')"
			@click="router.push({ name: 'SpaceList' })"
		>
			<img :src="logoUrl" alt="Frappe Wiki" class="size-6" />
		</button>

		<!-- Pages teleport their title / contextual controls (e.g. the space-tree
		     toggle and name) here. On a detail page that toggle sits on the left,
		     so the app menu lives on the right (below), out of its way. -->
		<div id="app-header" class="flex min-w-0 flex-1 items-center gap-2"></div>

		<!-- App menu (global nav) on the right; a hamburger reads as "menu"
		     far better than the logo did. -->
		<Dropdown :options="appMenuOptions">
			<button
				class="flex size-11 shrink-0 items-center justify-center rounded text-ink-gray-7 hover:bg-surface-gray-3"
				:title="__('Menu')"
				aria-label="Menu"
			>
				<LucideMenu class="size-5" />
			</button>
		</Dropdown>
	</header>
</template>

<script setup>
import { Dropdown } from 'frappe-ui';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import LucideMenu from '~icons/lucide/menu';
import { useSessionStore } from '@/stores/session';
import { useMobile } from '../composables/useMobile';
import { useTheme } from '../composables/useTheme';

const { mobileHasLeadingControl } = useMobile();
const router = useRouter();
const sessionStore = useSessionStore();
const { userTheme, toggleTheme, initTheme } = useTheme();

// On mobile the desktop Sidebar never mounts, so apply the saved theme here —
// otherwise a stored `wiki-theme` stays unapplied until the user toggles it.
onMounted(initTheme);

// Runtime string (not a bundled asset) — resolved by the Frappe server, the
// same way the desktop Sidebar references it.
const logoUrl = '/assets/wiki/images/wiki-logo.png';

const appMenuOptions = computed(() => [
	{
		label: __('Spaces'),
		icon: 'book-open',
		onClick: () => router.push({ name: 'SpaceList' }),
	},
	{
		label: __('Change Requests'),
		icon: 'git-branch',
		onClick: () => router.push({ name: 'ChangeRequests' }),
	},
	{
		label: __('Toggle Theme'),
		icon: userTheme.value === 'dark' ? 'sun' : 'moon',
		onClick: toggleTheme,
	},
	{
		label: __('Log out'),
		icon: 'log-out',
		onClick: () => sessionStore.logout.submit(),
	},
]);
</script>
