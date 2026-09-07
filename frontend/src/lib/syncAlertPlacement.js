import { ref, watch } from 'vue';

/**
 * TEMPORARY — a switch for trying the three placements of the sidebar's sync
 * notice against each other. Delete this module, SyncAlertPlacementSwitcher
 * and the branches that read `syncAlertPlacement` once one is chosen.
 *
 * The sidebar is a vertical stack, so anything that appears above the tree
 * pushes it down. `card` is what ships today and does exactly that; the other
 * two keep the tree's top edge fixed.
 */
export const SYNC_ALERT_PLACEMENTS = [
	{
		value: 'card',
		label: 'In card',
		hint: 'Today. Inside the change request card, above Merge — pushes the tree down ~48px.',
	},
	{
		value: 'below',
		label: 'Below tree',
		hint: 'Last row of the sidebar, under New page. Takes height from the scroller; the tree top never moves.',
	},
	{
		value: 'float',
		label: 'Floating',
		hint: 'Overlaid near the sidebar’s bottom edge. Nothing reflows; covers a couple of tree rows.',
	},
];

const STORAGE_KEY = 'wiki:sync-alert-placement';

function initial() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (SYNC_ALERT_PLACEMENTS.some((p) => p.value === stored)) return stored;
	} catch {
		// Private window, blocked storage — the default is fine.
	}
	return 'card';
}

export const syncAlertPlacement = ref(initial());

watch(syncAlertPlacement, (value) => {
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		// Nothing to do; the choice just won't survive a reload.
	}
});

/**
 * TEMPORARY — pins a state on so the placements can be compared without
 * waiting out the ten-second autosave. `''` means "show the real state".
 */
export const SYNC_ALERT_PREVIEWS = [
	{ value: '', label: 'Real' },
	{ value: 'unsaved', label: 'Unsaved' },
	{ value: 'saving', label: 'Saving' },
	{ value: 'failed', label: 'Failed' },
];

export const PREVIEW_STATES = {
	unsaved: { label: 'Unsaved changes', theme: 'gray', description: '' },
	saving: { label: 'Saving\u2026', theme: 'amber', description: '' },
	failed: {
		label: 'Sync failed',
		theme: 'red',
		description: 'Could not reach the server. Your changes are still here.',
	},
};

export const syncAlertPreview = ref('');
