import { computed, ref } from 'vue';
import { useMobile } from './useMobile';

// The view switch over `PageDiff`, shared by the review and version history.
export function useDiffView() {
	const { isMobile } = useMobile();
	const chosenView = ref('split');
	// A phone has no room for two columns.
	const view = computed({
		get: () =>
			isMobile.value && chosenView.value === 'split'
				? 'inline'
				: chosenView.value,
		set: (value) => {
			chosenView.value = value;
		},
	});
	const changesOnly = ref(false);
	const viewOptions = computed(() =>
		[
			{ value: 'split', label: __('Side by side'), icon: 'lucide-columns-2' },
			{ value: 'inline', label: __('Inline'), icon: 'lucide-rows-2' },
			{ value: 'markdown', label: __('Markdown'), icon: 'lucide-code' },
		].filter((option) => !isMobile.value || option.value !== 'split'),
	);
	return { view, changesOnly, viewOptions };
}
