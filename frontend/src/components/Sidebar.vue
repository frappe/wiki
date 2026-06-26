<template>
<Sidebar
	v-model:collapsed="isSidebarCollapsed"
	:header="header"
	:sections="sections"
/>
</template>

<script setup>
import { Sidebar } from "frappe-ui";

import { onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStorage } from "@vueuse/core";
import LucideRocket from "~icons/lucide/rocket";
import LucideGitBranch from "~icons/lucide/git-branch";
import LucideLogOut from "~icons/lucide/log-out";
import { useSessionStore } from "@/stores/session";
import { useUserStore } from "@/stores/user";
import { useTheme } from "../composables/useTheme";

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();
const userStore = useUserStore();

const { themeIcon, toggleTheme, initTheme } = useTheme();

const isSidebarCollapsed  = useStorage("is-sidebar-collapsed", false);

const header = computed(() => ({
	title: __("Frappe Wiki"),
	subtitle: userStore.data?.full_name,
	logo: "/assets/wiki/images/wiki-logo.png",
	menuItems: [
		{ label: __("Toggle Theme"), icon: themeIcon, onClick: toggleTheme },
		{ label: __("Log out"), icon: LucideLogOut, onClick: logout },
	],
}));

const navItems = [
	{ label: __("Spaces"), icon: LucideRocket, to: { name: "SpaceList" } },
	{ label: __("Change Requests"), icon: LucideGitBranch, to: { name: "ChangeRequests" } },
];

const sections = computed(() => [
	{
		label: "",
		items: navItems.map((item) => ({
			...item,
			isActive: route.path.startsWith(router.resolve(item.to).path),
		})),
	},
]);

onMounted(() => {
	initTheme();
});

function logout() {
	sessionStore.logout.submit();
}
</script>
