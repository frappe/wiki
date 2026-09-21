import { useTelemetry as useFrameworkTelemetry } from '@framework/ui/telemetry/index.ts';

export function useTelemetry() {
	const telemetry = useFrameworkTelemetry();
	return {
		capture: (event, props = {}) =>
			telemetry.capture(event, { ...window.telemetry, ...props }),
	};
}
