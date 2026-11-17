// How a version of a page or space reads in the history panel and above its diff.

export function versionAction(version) {
	if (version.source === 'merge') return __('merged');
	if (version.source === 'sync') {
		return version.source_commit
			? __('synced from {0}', [version.source_commit.slice(0, 7)])
			: __('synced from Git');
	}
	if (version.source === 'initial') return __('saved the first version');
	return __('edited in Desk');
}

export function versionTitle(version) {
	if (version.source === 'merge') return version.change_request_title;
	if (version.source === 'sync') return __('Repository sync');
	if (version.source === 'initial') return __('First version');
	return __('Direct edit');
}
