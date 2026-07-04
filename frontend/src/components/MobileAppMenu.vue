<template>
	<Dropdown :options="menuOptions" placement="right">
		<Button variant="ghost" :label="__('Menu')">
			<template #icon>
				<LucideMenu class="size-4" />
			</template>
		</Button>
	</Dropdown>
</template>

<script setup>
import { useSessionStore } from '@/stores/session';
import { useUserStore } from '@/stores/user';
import { Button, Dropdown } from 'frappe-ui';
import { computed } from 'vue';
import LucideLogOut from '~icons/lucide/log-out';
import LucideMenu from '~icons/lucide/menu';
import LucideSettings from '~icons/lucide/settings';
import { useTheme } from '../composables/useTheme';
import { useWikiSettings } from '../composables/useWikiSettings';

const sessionStore = useSessionStore();
const userStore = useUserStore();
const { open: openWikiSettings } = useWikiSettings();
const { themeIcon, toggleTheme } = useTheme();

const menuOptions = computed(() => [
	...(userStore.isWikiManager
		? [
				{
					label: __('Settings'),
					icon: LucideSettings,
					onClick: () => openWikiSettings(),
				},
			]
		: []),
	{ label: __('Toggle Theme'), icon: themeIcon.value, onClick: toggleTheme },
	{
		label: __('Log out'),
		icon: LucideLogOut,
		onClick: () => sessionStore.logout.submit(),
	},
]);
</script>
