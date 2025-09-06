<script setup lang="ts">
import { FrappeUIProvider, setConfig } from "frappe-ui";
import MainLayout from "./layouts/MainLayout.vue";

setConfig("systemTimezone", window.timezone?.system || null);
setConfig("localTimezone", window.timezone?.user || null);
</script>

<template>
	<FrappeUIProvider>
		<MainLayout>
			<router-view />
		</MainLayout>
	</FrappeUIProvider>
</template>