// `label` is a function, not a string: `__` is installed on window by the
// translation plugin during app boot, so a module-scope call throws in any
// chunk that loads before it — as this one now does, via the sidebar.
const CHANGE_TYPE_CONFIG = {
	added: {
		icon: 'lucide-plus',
		iconClass: 'bg-green-100 text-green-600',
		theme: 'green',
		dotClass: 'bg-surface-green-5',
		label: () => __('New'),
	},
	modified: {
		icon: 'lucide-pencil',
		iconClass: 'bg-blue-100 text-blue-600',
		theme: 'blue',
		dotClass: 'bg-surface-blue-5',
		label: () => __('Modified'),
	},
	deleted: {
		icon: 'lucide-trash-2',
		iconClass: 'bg-red-100 text-red-600',
		theme: 'red',
		dotClass: 'bg-surface-red-5',
		label: () => __('Deleted'),
	},
	reordered: {
		icon: 'lucide-arrow-up-down',
		iconClass: 'bg-amber-100 text-amber-600',
		theme: 'amber',
		dotClass: 'bg-surface-amber-5',
		label: () => __('Reordered'),
	},
};

const DEFAULT_CONFIG = {
	icon: 'lucide-file-text',
	iconClass: 'bg-gray-100 text-gray-600',
	theme: 'gray',
	dotClass: 'bg-surface-gray-5',
};

export function useChangeTypeDisplay() {
	function getConfig(changeType) {
		return (
			CHANGE_TYPE_CONFIG[changeType] || {
				...DEFAULT_CONFIG,
				label: () => changeType,
			}
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

	// The tree marks a changed page with a dot rather than a word, so the fill
	// is the only thing carrying the change type there. Written out as whole
	// class names: Tailwind scans this file, and a composed one would not
	// survive the build.
	function getChangeDotClass(changeType) {
		return getConfig(changeType).dotClass || DEFAULT_CONFIG.dotClass;
	}

	function getChangeLabel(changeType) {
		return getConfig(changeType).label();
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
		getChangeDotClass,
		getChangeLabel,
		getChangeDescription,
	};
}
