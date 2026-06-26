<template>
	<header
		class="flex h-14 shrink-0 items-center gap-2 border-b border-outline-gray-2 bg-surface-white px-3"
		:style="{ paddingTop: 'env(safe-area-inset-top)' }"
	>
		<!-- Logo doubles as the global-nav entry point (CRM has one sidebar;
		     our global nav is tiny, so it folds into this menu). -->
		<Dropdown :options="appMenuOptions">
			<button
				class="-ml-1 flex size-11 items-center justify-center rounded"
				:title="__('Menu')"
			>
				<img :src="logoUrl" alt="Frappe Wiki" class="size-7" />
			</button>
		</Dropdown>

		<!-- Pages teleport their contextual header (e.g. the space-tree toggle
		     and title) here; empty on pages that declare none. -->
		<div id="app-header" class="flex min-w-0 flex-1 items-center gap-2"></div>
	</header>
</template>

<script setup>
import { Dropdown } from 'frappe-ui';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import { useTheme } from '../composables/useTheme';

const router = useRouter();
const sessionStore = useSessionStore();
const { userTheme, toggleTheme } = useTheme();

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
