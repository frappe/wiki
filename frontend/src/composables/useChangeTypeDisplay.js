import LucideArrowUpDown from '~icons/lucide/arrow-up-down';
import LucideFileText from '~icons/lucide/file-text';
import LucidePencil from '~icons/lucide/pencil';
import LucidePlus from '~icons/lucide/plus';
import LucideTrash2 from '~icons/lucide/trash-2';

const CHANGE_TYPE_CONFIG = {
	added: {
		icon: LucidePlus,
		iconClass: 'bg-green-100 text-green-600',
		theme: 'green',
		label: __('New'),
	},
	modified: {
		icon: LucidePencil,
		iconClass: 'bg-blue-100 text-blue-600',
		theme: 'blue',
		label: __('Modified'),
	},
	deleted: {
		icon: LucideTrash2,
		iconClass: 'bg-red-100 text-red-600',
		theme: 'red',
		label: __('Deleted'),
	},
	reordered: {
		icon: LucideArrowUpDown,
		iconClass: 'bg-amber-100 text-amber-600',
		theme: 'orange',
		label: __('Reordered'),
	},
};

const DEFAULT_CONFIG = {
	icon: LucideFileText,
	iconClass: 'bg-gray-100 text-gray-600',
	theme: 'gray',
	label: '',
};

export function useChangeTypeDisplay() {
	function getConfig(changeType) {
		return (
			CHANGE_TYPE_CONFIG[changeType] || { ...DEFAULT_CONFIG, label: changeType }
		);
	}

	function getChangeIcon(changeType) {
		return getConfig(changeType).icon;
	}

	function getChangeIconClass(changeType) {
		return getConfig(changeType).iconClass;
	}

	function getChangeTheme(changeType) {
		return getConfig(changeType).theme;
	}

	function getChangeLabel(changeType) {
		return getConfig(changeType).label;
	}

	function getChangeDescription(changeType, isGroup, isExternalLink) {
		switch (changeType) {
			case 'added':
				if (isGroup) return __('New group to be created');
				if (isExternalLink) return __('New external link added');
				return __('New page to be created');
			case 'modified':
				return __('Content or metadata updated');
			case 'deleted':
				return __('Will be deleted');
			case 'reordered':
				return __('Order updated');
			default:
				return '';
		}
	}

	return {
		getChangeIcon,
		getChangeIconClass,
		getChangeTheme,
		getChangeLabel,
		getChangeDescription,
	};
}
