<template>
<Sidebar :header="{
			title: 'Frappe Wiki',
			logo: '/assets/wiki/images/wiki-logo.png',
			menuItems: [ { label: 'Toggle Theme', icon: themeIcon, onClick: toggleTheme },]
		}"

		:sections="[
			{
				label: '',
				items: [
					{label: 'Spaces', icon: LucideRocket, to: '/'},
				]
			}
		]"/>
</template>

<script setup>
import { Sidebar } from "frappe-ui";

import { onMounted, computed } from "vue";
import { useStorage } from "@vueuse/core";
import LucideMoon from "~icons/lucide/moon";
import LucideSun from "~icons/lucide/sun";
import LucideRocket from "~icons/lucide/rocket";

const userTheme = useStorage("user-theme", "dark");

const themeIcon = computed(() => {
	return userTheme.value === "dark" ? LucideSun : LucideMoon;
});

onMounted(() => {
	document.documentElement.setAttribute("data-theme", userTheme.value);
});

function toggleTheme() {
	const currentTheme = userTheme.value;
	const newTheme = currentTheme === "dark" ? "light" : "dark";
	document.documentElement.setAttribute("data-theme", newTheme);
	userTheme.value = newTheme;
}
</script>