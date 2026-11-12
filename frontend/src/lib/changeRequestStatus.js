const STATUS_THEMES = {
	Draft: 'blue',
	'In Review': 'amber',
	'Changes Requested': 'red',
	Approved: 'green',
	Merged: 'green',
	Rejected: 'red',
	Archived: 'gray',
};

export function statusTheme(status) {
	return STATUS_THEMES[status] || 'gray';
}
