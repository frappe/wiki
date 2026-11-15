import { toast } from 'frappe-ui';
import { ref } from 'vue';
import { useSpaceStore } from '../stores/space';

const starting = ref(false);
let pending = null;

export function useStartEditing() {
	const spaceStore = useSpaceStore();

	// The title is a placeholder: submitting for review asks for the real one.
	function requireEditing(title) {
		if (spaceStore.isEditing) return Promise.resolve(true);
		if (!spaceStore.isReading) return Promise.resolve(false);
		pending ??= start(title);
		return pending;
	}

	async function start(title) {
		starting.value = true;
		try {
			await spaceStore.startEditing(title);
			return true;
		} catch (error) {
			toast.error(error.messages?.[0] || __('Could not start editing'));
			return false;
		} finally {
			starting.value = false;
			pending = null;
		}
	}

	return { starting, requireEditing };
}
