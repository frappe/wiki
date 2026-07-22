// Helpers for the GitHub one-way sync feature (read-only synced spaces).

const MARKDOWN_EXT = /\.(md|mdx)$/i;

// A synced node only has an editable GitHub source when its source_path points
// at a markdown file. Folder-only groups (no README/index landing) store the
// directory path, which has nothing to open in GitHub's editor.
export function isEditableSourcePath(sourcePath) {
	return Boolean(sourcePath && MARKDOWN_EXT.test(sourcePath));
}

// Build the URL that opens a synced page's source file in GitHub's web editor.
// Returns null when the inputs can't form a valid edit link.
export function buildGithubEditUrl({ repoFullName, branch, sourcePath }) {
	if (!repoFullName || !branch || !isEditableSourcePath(sourcePath)) {
		return null;
	}
	const path = sourcePath.replace(/^\/+/, '');
	return `https://github.com/${repoFullName}/edit/${branch}/${path}`;
}
