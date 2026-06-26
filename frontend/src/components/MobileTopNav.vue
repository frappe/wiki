<template>
	<header
		class="flex h-14 shrink-0 items-center gap-2 border-b border-outline-gray-2 bg-surface-white px-3"
		:style="{ paddingTop: 'env(safe-area-inset-top)' }"
	>
		<!-- Hamburger is the global-nav entry point (CRM has one sidebar; our
		     global nav is tiny, so it folds into this menu). A hamburger reads
		     as "menu" far better than the logo did. -->
		<Dropdown :options="appMenuOptions">
			<button
				class="flex size-11 items-center justify-center rounded text-ink-gray-7 hover:bg-surface-gray-3"
				:title="__('Menu')"
				aria-label="Menu"
			>
				<LucideMenu class="size-5" />
			</button>
		</Dropdown>

		<!-- Pages teleport their title / contextual controls (e.g. the space-tree
		     toggle and name) here, so the bar reads "[≡] Page Title". -->
		<div id="app-header" class="flex min-w-0 flex-1 items-center gap-2"></div>
	</header>
</template>

<script setup>
import { Dropdown } from 'frappe-ui';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import LucideMenu from '~icons/lucide/menu';
import { useSessionStore } from '@/stores/session';
import { useTheme } from '../composables/useTheme';

const router = useRouter();
const sessionStore = useSessionStore();
const { userTheme, toggleTheme } = useTheme();

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
