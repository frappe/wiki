// Kept free of node view imports so markdown code and `node --test` can use it.

/**
 * Video extensions that should be rendered as video players
 */
export const VIDEO_EXTENSIONS = [
	'.mp4',
	'.webm',
	'.ogg',
	'.mov',
	'.avi',
	'.mkv',
	'.m4v',
];

/**
 * Check if a URL is a video URL based on file extension
 */
export function isVideoUrl(url) {
	if (!url) return false;
	const cleanUrl = String(url).split(/[?#]/)[0].toLowerCase();
	return VIDEO_EXTENSIONS.some((ext) => cleanUrl.endsWith(ext));
}

/**
 * Check if a URL points to a PDF based on its file extension.
 */
export function isPdfUrl(url) {
	if (!url) return false;
	const cleanUrl = String(url).split(/[?#]/)[0].toLowerCase();
	return cleanUrl.endsWith('.pdf');
}
