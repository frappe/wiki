<script setup lang="ts">
import { FrappeUIProvider, setConfig, toast } from 'frappe-ui';
import { ConfigProvider } from 'reka-ui';
import { onBeforeUnmount, onMounted } from 'vue';
import MainLayout from './layouts/MainLayout.vue';
import { useSocket } from './socket';

setConfig('systemTimezone', window.timezone?.system || null);
setConfig('localTimezone', window.timezone?.user || null);

const dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';

// Realtime reviewer-decision pings to the change-request author. The matching
// Notification Log entry (created server-side) is the durable copy; this is
// just the live nudge while the author has the app open.
function onChangeRequestUpdate(data: { subject?: string }) {
	if (data?.subject) toast.info(data.subject);
}

onMounted(() => {
	useSocket()?.on('wiki_change_request_update', onChangeRequestUpdate);
});
onBeforeUnmount(() => {
	useSocket()?.off('wiki_change_request_update', onChangeRequestUpdate);
});
</script>

<template>
	<ConfigProvider :dir="dir">
		<FrappeUIProvider>
			<MainLayout>
				<router-view />
			</MainLayout>
		</FrappeUIProvider>
	</ConfigProvider>
</template>