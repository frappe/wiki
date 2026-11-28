// frappe-ui uses this text when the response carries no reason.
const NO_REASON = 'Upload failed';

function serverReason(error) {
	// Only frappe-ui's UploadError has a kind. Other errors hold technical text.
	if (!error?.kind) return '';
	const reason = (error.message || '').replace(/<\/?[a-z][^>]*>/gi, '').trim();
	return reason === NO_REASON ? '' : reason;
}

function fallbackReason(error) {
	if (error?.status === 413) return __('This file is too large to upload.');
	// A dropped connection reaches frappe-ui as a server error with status 0.
	if (error?.kind === 'network' || error?.status === 0) {
		return __('Check your connection and try again.');
	}
	return __('The file could not be saved. Try again.');
}

export function uploadErrorMessage(error) {
	const reason = serverReason(error) || fallbackReason(error);
	return __('Upload failed: {0}', [reason]);
}
