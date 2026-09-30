/**
 * Markdown serialization for the image node.
 *
 * Split out of image-extension.js so it can be unit tested: that module
 * imports a .vue node view at the top level, which `node --test` cannot load.
 */
export function renderImageMarkdown(node) {
	// Skip images still uploading/optimizing, or whose upload failed — their
	// `src` is a transient base64 preview that must never be written to saved
	// content. Once the upload resolves, `loading` clears and the node
	// re-serializes normally.
	if (node.attrs?.loading || node.attrs?.error) {
		return '';
	}

	const src = node.attrs?.src ?? '';
	const alt = node.attrs?.alt ?? '';
	const title = node.attrs?.title ?? '';
	const caption = (node.attrs?.caption ?? '').trim();

	let md = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;

	// Add caption on next line (no blank line) if present
	if (caption) {
		md += `\n*${caption}*`;
	}

	return md;
}
