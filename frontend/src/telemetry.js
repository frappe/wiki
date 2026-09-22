import { watch } from 'vue';

import { useTelemetry as useFrameworkTelemetry } from '@framework/ui/telemetry/index.ts';
import { fetchBootConfig } from '@framework/ui/telemetry/pulse.ts';

export function useTelemetry() {
	const telemetry = useFrameworkTelemetry();
	return {
		capture: (event, props = {}) =>
			telemetry.capture(event, { ...window.telemetry, ...props }),
	};
}

const NEW_SITE_DAYS = 15;

export async function trackPageviews(router) {
	const { site_age } = await fetchBootConfig();
	if (site_age > NEW_SITE_DAYS) return;

	const telemetry = useFrameworkTelemetry();
	const { capture } = useTelemetry();
	let lastFullPath = '';

	const capturePageview = (to) => {
		if (!telemetry.isEnabled || to.fullPath === lastFullPath) return;
		lastFullPath = to.fullPath;
		const matched = to.matched[to.matched.length - 1];
		capture('pageview', { route: matched?.path || 'unmatched' });
	};

	const stop = watch(
		() => telemetry.isEnabled,
		(enabled) => {
			if (!enabled) return;
			router.isReady().then(() => capturePageview(router.currentRoute.value));
			stop();
		},
		{ immediate: true },
	);
	router.afterEach(capturePageview);
}
