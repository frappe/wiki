import { ref } from 'vue';

const showSpaceSettings = ref(false);
const selectedTab = ref('general');
const analyticsPage = ref(null);

export function useSpaceSettings() {
	function open() {
		showSpaceSettings.value = true;
	}

	function close() {
		showSpaceSettings.value = false;
	}

	function openAnalytics(page = null) {
		selectedTab.value = 'analytics';
		analyticsPage.value = page;
		showSpaceSettings.value = true;
	}

	return {
		showSpaceSettings,
		selectedTab,
		analyticsPage,
		open,
		close,
		openAnalytics,
	};
}
