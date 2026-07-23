import { createResource } from 'frappe-ui';
import { ref, watch } from 'vue';

// Merge/publish ability is governed per-space by the role config (managers
// always qualify). Enforcement stays server-side (`can_write_space`); this
// only controls whether publish-capable UI shows.
export function useSpaceCapabilities(spaceIdSource) {
	const capabilities = ref({ can_read: false, can_write: false });
	const capabilitiesResource = createResource({
		url: 'wiki.api.get_space_capabilities',
		onSuccess: (data) => {
			capabilities.value = data;
		},
	});

	watch(
		spaceIdSource,
		(space) => {
			if (space) capabilitiesResource.submit({ space });
		},
		{ immediate: true },
	);

	return { capabilities };
}
