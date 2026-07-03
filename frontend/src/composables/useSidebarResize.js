import { ref } from 'vue';

const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;
const SNAP_THRESHOLD = 10;

export function useSidebarResize(sidebarRef) {
	const storedWidth = localStorage.getItem('wiki-sidebar-width');
	const sidebarWidth = ref(
		storedWidth ? Number.parseInt(storedWidth) : DEFAULT_SIDEBAR_WIDTH,
	);
	const sidebarResizing = ref(false);

	function startResize(e) {
		e.preventDefault();
		document.addEventListener('mousemove', resize);
		document.addEventListener(
			'mouseup',
			() => {
				document.body.classList.remove('select-none');
				document.body.classList.remove('cursor-col-resize');
				localStorage.setItem(
					'wiki-sidebar-width',
					sidebarWidth.value.toString(),
				);
				sidebarResizing.value = false;
				document.removeEventListener('mousemove', resize);
			},
			{ once: true },
		);
	}

	function resize(e) {
		sidebarResizing.value = true;
		document.body.classList.add('select-none');
		document.body.classList.add('cursor-col-resize');

		// Calculate width relative to sidebar's left position
		const sidebarLeft = sidebarRef.value?.getBoundingClientRect().left || 0;
		let newWidth = e.clientX - sidebarLeft;

		// Snap to default width when within threshold
		const snapRange = [
			DEFAULT_SIDEBAR_WIDTH - SNAP_THRESHOLD,
			DEFAULT_SIDEBAR_WIDTH + SNAP_THRESHOLD,
		];
		if (newWidth > snapRange[0] && newWidth < snapRange[1]) {
			newWidth = DEFAULT_SIDEBAR_WIDTH;
		}

		// Clamp width to min/max bounds
		newWidth = Math.max(
			MIN_SIDEBAR_WIDTH,
			Math.min(MAX_SIDEBAR_WIDTH, newWidth),
		);

		sidebarWidth.value = newWidth;
	}

	return {
		sidebarWidth,
		sidebarResizing,
		startResize,
		resize,
	};
}
