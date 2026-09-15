"""
Wiki markdown → HTML renderer (markdown-it-py + custom callout/aside support).

Callout syntax:
    :::note
    Content here
    :::

    :::tip[Custom Title]
    Content with custom title
    :::

Supported types: note, tip, caution, danger, warning (alias for caution)
"""

import re

from markdown_it import MarkdownIt
from markdown_it.common.utils import escapeHtml
from markdown_it.token import Token
from mdit_py_plugins.footnote import footnote_plugin
from mdit_py_plugins.tasklists import tasklists_plugin


def slugify(text: str) -> str:
	"""
	Convert text to a URL-friendly slug for heading IDs.

	Args:
	    text: The heading text to slugify

	Returns:
	    A lowercase, hyphenated slug suitable for use as an HTML id
	"""
	# Remove HTML tags if any
	text = re.sub(r"<[^>]+>", "", text)
	# Convert to lowercase
	text = text.lower()
	# Replace spaces with hyphens (preserve underscores for code-like headings)
	text = re.sub(r"\s+", "-", text)
	# Remove characters that aren't alphanumerics, hyphens, underscores, or unicode letters
	text = re.sub(r"[^\w\-]", "", text, flags=re.UNICODE)
	# Remove leading/trailing hyphens
	text = text.strip("-")
	# Collapse multiple hyphens
	text = re.sub(r"-+", "-", text)
	return text


# Default titles for each callout type
DEFAULT_TITLES = {
	"note": "Note",
	"tip": "Tip",
	"caution": "Caution",
	"danger": "Danger",
	"warning": "Caution",  # warning is alias for caution
}

# SVG icons for each callout type.
#
# The frappe-ui Alert status glyphs (icon/solid/* in Figma) — the same paths the
# editor's node view inlines, kept in sync by hand: the SFCs behind
# `solidStatusIcons` are not exported from frappe-ui/icons, and this renderer
# has no build step that could import them.
CALLOUT_ICONS = {
	"note": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM8 6.93652C7.72386 6.93652 7.5 7.16038 7.5 7.43652V11.1436C7.50005 11.4197 7.72389 11.6436 8 11.6436C8.27611 11.6436 8.49995 11.4197 8.5 11.1436V7.43652C8.5 7.16038 8.27614 6.93652 8 6.93652ZM8 4C7.51675 4 7.125 4.39175 7.125 4.875C7.125 5.35825 7.51675 5.75 8 5.75C8.48325 5.75 8.875 5.35825 8.875 4.875C8.875 4.39175 8.48325 4 8 4Z" fill="currentColor"/></svg>',
	"tip": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM11.1055 5.28125C10.8924 5.10562 10.5771 5.13567 10.4014 5.34863L6.95215 9.53223L5.61035 7.79883C5.44143 7.58051 5.12757 7.54022 4.90918 7.70898C4.69088 7.8779 4.65061 8.19177 4.81934 8.41016L6.54395 10.6396C6.63696 10.7598 6.77972 10.8306 6.93164 10.833C7.08364 10.8354 7.22849 10.7687 7.3252 10.6514L11.1729 5.98438C11.3481 5.77144 11.3181 5.45689 11.1055 5.28125Z" fill="currentColor"/></svg>',
	"caution": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.35174 1.97129C7.64143 1.47669 8.35697 1.47669 8.64666 1.97129L15.0519 12.9078C15.3447 13.4077 14.9847 14.0365 14.4055 14.0367H1.59295C1.0138 14.0364 0.653701 13.4077 0.946469 12.9078L7.35174 1.97129ZM7.9992 10.4117C7.51609 10.4118 7.12433 10.8036 7.1242 11.2867C7.1242 11.7699 7.51601 12.1617 7.9992 12.1617C8.48245 12.1617 8.8742 11.77 8.8742 11.2867C8.87408 10.8036 8.48238 10.4117 7.9992 10.4117ZM8.00018 5.50742C7.72411 5.50742 7.5003 5.73139 7.50018 6.00742V9.25742C7.50018 9.53356 7.72404 9.75742 8.00018 9.75742C8.27615 9.75723 8.50018 9.53344 8.50018 9.25742V6.00742C8.50006 5.73151 8.27608 5.50762 8.00018 5.50742Z" fill="currentColor"/></svg>',
	"danger": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1C11.866 1 15 4.13401 15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1ZM10.8535 5.14648C10.6583 4.95122 10.3417 4.95122 10.1465 5.14648L8 7.29297L5.85352 5.14648C5.65825 4.95122 5.34175 4.95122 5.14648 5.14648C4.95122 5.34175 4.95122 5.65825 5.14648 5.85352L7.29297 8L5.14648 10.1465C4.95122 10.3417 4.95122 10.6583 5.14648 10.8535C5.34175 11.0488 5.65825 11.0488 5.85352 10.8535L8 8.70703L10.1465 10.8535C10.3417 11.0488 10.6583 11.0488 10.8535 10.8535C11.0488 10.6583 11.0488 10.3417 10.8535 10.1465L8.70703 8L10.8535 5.85352C11.0488 5.65825 11.0488 5.34175 10.8535 5.14648Z" fill="currentColor"/></svg>',
}

# Pattern to match callout blocks
# Matches: :::type or :::type[title] or :::type\[title] (escaped bracket from editor)
# Content continues until closing :::
CALLOUT_PATTERN = re.compile(
	r"^[ \t]*:::(?P<type>note|tip|caution|danger|warning)(?:\\?\[(?P<title>[^\]]*)\])?\s*\n(?P<content>[\s\S]*?)\n[ \t]*:::[ \t]*$",
	re.MULTILINE,
)


def _generate_callout_html(callout_type, title, inner_html):
	"""Generate HTML for a callout block."""
	# Normalize warning to caution for consistency
	if callout_type == "warning":
		callout_type = "caution"

	# Use default title if none provided or empty
	if not title:
		title = DEFAULT_TITLES.get(callout_type, callout_type.capitalize())

	icon = CALLOUT_ICONS.get(callout_type, CALLOUT_ICONS["note"])

	# Header row, then a full-width body — the layout frappe-ui's Alert uses for
	# its banner form. The editor's node view builds the same three elements.
	return (
		f'<aside class="callout callout-{callout_type}">\n'
		f'<div class="callout-header">\n'
		f'<span class="callout-icon">{icon}</span>\n'
		f'<span class="callout-title">{title}</span>\n'
		f"</div>\n"
		f'<div class="callout-content">{inner_html}</div>\n'
		f"</aside>"
	)


def _standalone_block(match: "re.Match", body: str) -> str:
	"""
	Wrap `body` in just enough newlines to stand alone as a block, without changing
	the blank-line gap the author wrote around the replaced text.

	Returning an unconditional "\\n\\n{body}\\n\\n" would inflate every gap adjacent to
	a callout/video/PDF by two newlines, which _blank_line_rule then materialises as
	a phantom empty paragraph on each side.
	"""
	src = match.string
	before, after = src[: match.start()], src[match.end() :]
	lead = "" if (not before or before.endswith("\n\n")) else ("\n" if before.endswith("\n") else "\n\n")
	trail = "" if (not after or after.startswith("\n\n")) else ("\n" if after.startswith("\n") else "\n\n")
	return lead + body + trail


def _process_callouts_with_placeholders(content):
	"""
	Replace callout blocks with placeholders, returning the modified content
	and a list of callout data to be processed later.
	"""
	callouts = []
	placeholder_prefix = "WIKICALLOUTPLACEHOLDER"

	def replacer(match):
		callout_type = match.group("type")
		title = match.group("title") or ""
		inner_content = match.group("content")

		# Remove escape backslashes from title (editor escapes special chars like !)
		if title:
			title = title.replace("\\", "")

		idx = len(callouts)
		callouts.append(
			{
				"type": callout_type,
				"title": title,
				"content": inner_content.strip(),
			}
		)
		return _standalone_block(match, f"{placeholder_prefix}{idx}END")

	# Process callouts (may be nested, so we process iteratively)
	prev_content = None
	while prev_content != content:
		prev_content = content
		content = CALLOUT_PATTERN.sub(replacer, content)

	return content, callouts, placeholder_prefix


def _replace_callout_placeholders(html, callouts, placeholder_prefix, render_inner):
	"""Replace callout placeholders with actual HTML after markdown rendering."""
	for idx, callout in enumerate(callouts):
		placeholder = f"{placeholder_prefix}{idx}END"
		inner_html = render_inner(callout["content"]) if callout["content"] else ""
		callout_html = _generate_callout_html(callout["type"], callout["title"], inner_html)

		# Replace placeholder (may be wrapped in <p> tags)
		html = html.replace(f"<p>{placeholder}</p>", callout_html)
		html = html.replace(placeholder, callout_html)

	return html


# Pattern to match markdown image syntax: ![alt](url) or ![alt](url "title")
# URL allows one level of balanced parens so Frappe uploads named like
# `/files/image (14).png` are matched whole.
IMAGE_PATTERN = re.compile(
	r'!\[([^\]]*)\]\(((?:[^()"]|\([^()"]*\))+?)(?:\s+"([^"]*)")?\)',
)

VIDEO_EXTENSIONS = (
	".mp4",
	".webm",
	".ogg",
	".mov",
	".avi",
	".mkv",
	".m4v",
)


def _is_video_url(url: str) -> bool:
	"""Return True when URL points to a known video file extension."""
	if not url:
		return False

	clean_url = str(url).split("?", 1)[0].split("#", 1)[0].lower()
	return clean_url.endswith(VIDEO_EXTENSIONS)


def _is_pdf_url(url: str) -> bool:
	"""Return True when URL points to a PDF file."""
	if not url:
		return False

	clean_url = str(url).split("?", 1)[0].split("#", 1)[0].lower()
	return clean_url.endswith(".pdf")


SCRIPT_TAG_PATTERN = re.compile(r"(?is)<script\b[^>]*>.*?</script>|</?script\b[^>]*>")


def _remove_script_tags(value: str | None) -> str:
	"""Remove only <script> tags/content; keep all other HTML unchanged."""
	if not value:
		return ""
	return SCRIPT_TAG_PATTERN.sub("", str(value))


# Match full-line markdown image syntax with optional title:
# ![alt](url) or ![alt](url "title")
VIDEO_MARKDOWN_PATTERN = re.compile(
	r'^!\[(?P<alt>[^\]]*)\]\((?P<url>(?:[^()"\s]|\([^()"\s]*\))+?)(?:\s+"(?P<title>[^"]*)")?\)[ \t]*$',
	re.MULTILINE,
)


def _generate_video_html(url: str, alt: str = "", title: str = "") -> str:
	"""Generate HTML for a video block."""
	safe_alt = _remove_script_tags(alt)
	safe_title = _remove_script_tags(title)
	title_attr = f' title="{safe_title}"' if safe_title else ""
	data_alt_attr = f' data-alt="{safe_alt}"' if safe_alt else ""
	return (
		f'<div data-type="video-block" data-src="{url}"{data_alt_attr}>'
		f'<video src="{url}" controls preload="metadata"{title_attr}>'
		f'<source src="{url}" />'
		"</video></div>"
	)


def _process_videos_with_placeholders(content: str) -> tuple[str, list[dict], str]:
	"""
	Replace full-line video markdown with placeholders so videos render as block HTML.
	"""
	videos = []
	placeholder_prefix = "WIKIVIDEOPLACEHOLDER"

	def replacer(match):
		url = match.group("url") or ""
		if not _is_video_url(url):
			return match.group(0)

		idx = len(videos)
		videos.append(
			{
				"url": url,
				"alt": match.group("alt") or "",
				"title": match.group("title") or "",
			}
		)
		return _standalone_block(match, f"{placeholder_prefix}{idx}END")

	return VIDEO_MARKDOWN_PATTERN.sub(replacer, content), videos, placeholder_prefix


def _replace_video_placeholders(html: str, videos: list[dict], placeholder_prefix: str) -> str:
	"""Replace video placeholders with block video HTML."""
	for idx, video in enumerate(videos):
		placeholder = f"{placeholder_prefix}{idx}END"
		video_html = _generate_video_html(video["url"], video["alt"], video["title"])
		html = html.replace(f"<p>{placeholder}</p>", video_html)
		html = html.replace(placeholder, video_html)
	return html


# Inline SVG icons for the PDF card (lucide: file-text, maximize-2, download).
_PDF_ICON_SVG = (
	'<svg class="wiki-pdf-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18"'
	' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
	' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
	'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>'
	'<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/>'
	'<path d="M16 17H8"/></svg>'
)
_PDF_OPEN_ICON_SVG = (
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"'
	' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
	' stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/>'
	'<polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/>'
	'<line x1="3" x2="10" y1="21" y2="14"/></svg>'
)
_PDF_DOWNLOAD_ICON_SVG = (
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"'
	' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
	' stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2'
	' 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15"'
	' y2="3"/></svg>'
)


def _generate_pdf_html(url: str, filename: str = "") -> str:
	"""Generate the PDF embed card. The first-page thumbnail and the full-screen
	viewer are hydrated client-side by wiki/public/js/pdf-viewer.js (PDF.js)."""
	safe_name = _remove_script_tags(filename) or "Document.pdf"
	return (
		f'<div class="wiki-pdf-embed" data-type="pdf-block" data-src="{url}"'
		f' data-filename="{safe_name}">'
		f'<div class="wiki-pdf-card">'
		f'<div class="wiki-pdf-header">'
		f"{_PDF_ICON_SVG}"
		f'<span class="wiki-pdf-name">{safe_name}</span>'
		f'<span class="wiki-pdf-pages" data-role="pages"></span>'
		f'<span class="wiki-pdf-actions">'
		f'<button type="button" class="wiki-pdf-action" data-role="open"'
		f' title="Open viewer" aria-label="Open viewer">{_PDF_OPEN_ICON_SVG}</button>'
		f'<a class="wiki-pdf-action" href="{url}" download target="_blank" rel="noopener"'
		f' title="Download" aria-label="Download">{_PDF_DOWNLOAD_ICON_SVG}</a>'
		f"</span>"
		f"</div>"
		f'<div class="wiki-pdf-scroll" data-role="scroll"></div>'
		f'<noscript><a class="wiki-pdf-noscript" href="{url}">Open {safe_name}</a></noscript>'
		f"</div>"
		f"</div>"
	)


def _process_pdfs_with_placeholders(content: str) -> tuple[str, list[dict], str]:
	"""
	Replace full-line PDF markdown with placeholders so PDFs render as block cards.
	Reuses the video full-line image-syntax pattern; videos are extracted first, so
	only PDF URLs remain to match here.
	"""
	pdfs = []
	placeholder_prefix = "WIKIPDFPLACEHOLDER"

	def replacer(match):
		url = match.group("url") or ""
		if not _is_pdf_url(url):
			return match.group(0)

		idx = len(pdfs)
		pdfs.append({"url": url, "filename": match.group("alt") or ""})
		return _standalone_block(match, f"{placeholder_prefix}{idx}END")

	return VIDEO_MARKDOWN_PATTERN.sub(replacer, content), pdfs, placeholder_prefix


def _replace_pdf_placeholders(html: str, pdfs: list[dict], placeholder_prefix: str) -> str:
	"""Replace PDF placeholders with block PDF card HTML."""
	for idx, pdf in enumerate(pdfs):
		placeholder = f"{placeholder_prefix}{idx}END"
		pdf_html = _generate_pdf_html(pdf["url"], pdf["filename"])
		html = html.replace(f"<p>{placeholder}</p>", pdf_html)
		html = html.replace(placeholder, pdf_html)
	return html


def _encode_image_url_spaces(content: str) -> str:
	"""
	Pre-process markdown to URL-encode literal spaces in image URLs.

	CommonMark forbids unescaped whitespace in URLs, but Frappe uploads
	routinely contain spaces (e.g. `/files/my image.png`). The matching
	regex tolerates balanced parens so URLs like `/files/image (14).png`
	are captured whole — the parser handles those parens natively.
	"""

	def encode_url(match):
		alt_text = match.group(1)
		url = match.group(2).strip().replace(" ", "%20")
		title = match.group(3)

		if title:
			return f'![{alt_text}]({url} "{title}")'
		return f"![{alt_text}]({url})"

	return IMAGE_PATTERN.sub(encode_url, content)


# Private-use Unicode sentinel — stands in for `|` inside inline-code on table
# rows during parsing, then gets swapped back after rendering. Both Mistune and
# markdown-it-py count raw pipes per row in their table plugin and reject the
# whole block on mismatch, dropping the table to a paragraph; hiding the inner
# pipes behind a PUA sentinel keeps the column count honest.
_TABLE_CODE_PIPE_SENTINEL = ""


def _escape_table_inline_code_pipes(content: str) -> str:
	"""Swap `|` inside inline-code spans on table-row lines for a sentinel."""
	lines = content.split("\n")
	in_fence = False
	fence_marker: str | None = None

	def replace_span(match: re.Match) -> str:
		return match.group(0).replace("|", _TABLE_CODE_PIPE_SENTINEL)

	for i, line in enumerate(lines):
		stripped = line.lstrip()
		if not in_fence and (stripped.startswith("```") or stripped.startswith("~~~")):
			in_fence = True
			fence_marker = stripped[:3]
			continue
		if in_fence:
			if fence_marker and stripped.startswith(fence_marker):
				in_fence = False
				fence_marker = None
			continue
		if "|" not in line or not stripped.startswith("|"):
			continue
		lines[i] = re.sub(r"`[^`\n]+`", replace_span, line)

	return "\n".join(lines)


BLANK_LINE_TOKEN = "wiki_blank_line"

# Block types after which a gap is ignored. Empty on purpose: marked (the editor's
# parser) swallows trailing newlines after headings, tables, HTML blocks, indented
# code and callouts, so the editor shows no gap there — but the blank lines are in
# the stored markdown, so we render them. Populate this to mirror marked instead.
_GAP_SUPPRESSING_PREV_BLOCKS: frozenset[str] = frozenset()

# Footnote definitions are relocated to the end of the document by the plugin's
# `footnote_tail` core rule, so a gap measured at their original position would
# leave an orphaned blank paragraph behind. Never anchor a gap to them.
_GAP_ANCHOR_SKIP = frozenset({"footnote_reference_open", "footnote_block_open"})


def _blank_line_rule(state) -> None:
	"""
	Materialise author-typed blank lines between top-level blocks.

	CommonMark discards runs of blank lines, but `.prose-v3` sets `p { margin: 0 }` —
	blank lines *are* the spacing mechanism, and the editor models them as empty
	paragraphs. Mirror @tiptap/markdown's arithmetic: a gap of `g` blank lines yields
	`(g + 1) // 2 - 1` empty paragraphs (g=1,2 -> 0; g=3,4 -> 1; g=5 -> 2), and `g // 2`
	at the start of the document, where the run has no leading newline.

	Gaps are measured by scanning `state.src` backwards from the block's first line,
	never from the previous token's `map[1]`: markdown-it folds trailing blank lines
	into a list's map, so `map[1]` under-reports.

	Out of scope, deliberately: blank lines nested inside list items and blockquotes
	(markdown-it exposes no container-relative line map) and trailing blank lines at
	the end of a document (they have no block to anchor to, and every git-synced file
	ending in a stray newline would gain a dead band).
	"""
	lines = state.src.split("\n")

	def is_blank(index: int) -> bool:
		return 0 <= index < len(lines) and not lines[index].strip()

	tokens = []
	prev_type = None
	for token in state.tokens:
		# Opening/self-closing top-level blocks only: closing tokens carry no map, and
		# nested tokens (list items, table cells, tight-list paragraphs) are level > 0.
		is_anchor = (
			token.level == 0
			and token.map
			and token.nesting >= 0
			and token.type not in _GAP_ANCHOR_SKIP
			and prev_type not in _GAP_SUPPRESSING_PREV_BLOCKS
		)
		if is_anchor:
			line = token.map[0] - 1
			gap = 0
			while is_blank(line):
				gap += 1
				line -= 1
			count = gap // 2 if line < 0 else (gap + 1) // 2 - 1
			for _ in range(max(count, 0)):
				blank = Token(BLANK_LINE_TOKEN, "", 0)
				blank.block = True
				tokens.append(blank)
		if token.level == 0 and token.nesting >= 0:
			prev_type = token.type
		tokens.append(token)

	state.tokens = tokens


def _render_blank_line(tokens, idx, options, env) -> str:
	# An empty <p> collapses to zero height under `p { margin: 0 }`; the <br> gives it
	# a line box even where the stylesheet never loads (PDF export).
	return '<p class="wiki-blank-line" aria-hidden="true"><br></p>\n'


def _build_markdown() -> MarkdownIt:
	"""Build a configured markdown-it-py instance with our render overrides."""
	md = (
		MarkdownIt("commonmark", {"html": True, "breaks": True, "linkify": False, "typographer": False})
		.enable(["table", "strikethrough"])
		.use(footnote_plugin)
		.use(tasklists_plugin, enabled=True)
	)

	def _render_codeblock_html(content: str, lang: str = "") -> str:
		# Trim trailing whitespace the author left inside the fence — spaces,
		# tabs, and blank lines all render as phantom empty rows in <pre>.
		content = content.rstrip() + "\n"
		# A ```mermaid fence is a diagram, not code: emit a bare <pre class="mermaid">
		# holding the escaped source. mermaid-renderer.js hydrates it into an SVG
		# client-side; with no JS it degrades to the raw source. No <code> wrapper,
		# so code-blocks.js / highlight.js leaves it alone.
		if lang == "mermaid":
			return f'<pre class="mermaid">{escapeHtml(content)}</pre>\n'
		cls = f' class="language-{escapeHtml(lang)}"' if lang else ""
		return f"<pre><code{cls}>{escapeHtml(content)}</code></pre>\n"

	def fence_rstrip(tokens, idx, options, env):
		tok = tokens[idx]
		lang = next(iter((tok.info or "").split()), "")
		return _render_codeblock_html(tok.content, lang)

	def code_block_rstrip(tokens, idx, options, env):
		return _render_codeblock_html(tokens[idx].content)

	md.renderer.rules["fence"] = fence_rstrip
	md.renderer.rules["code_block"] = code_block_rstrip

	def image_render(tokens, idx, options, env):
		tok = tokens[idx]
		src = tok.attrGet("src") or ""
		alt = _remove_script_tags(tok.content)
		title = _remove_script_tags(tok.attrGet("title") or "")

		if _is_video_url(src):
			title_attr = f' title="{title}"' if title else ""
			data_alt_attr = f' data-alt="{alt}"' if alt else ""
			return (
				f'<div data-type="video-block" data-src="{src}"{data_alt_attr}>'
				f'<video src="{src}" controls preload="metadata"{title_attr}>'
				f'<source src="{src}" />'
				"</video></div>"
			)
		if _is_pdf_url(src):
			return _generate_pdf_html(src, alt)
		s = f'<img src="{src}" alt="{alt}"'
		if title:
			s += f' title="{title}"'
		return s + " />"

	md.renderer.rules["image"] = image_render

	# after("block"): tokens and their line maps exist, `state.src` is already
	# normalized (CRLF collapsed, so it lines up with the maps), and we still run
	# before the footnote plugin's `footnote_tail`, which reorders the token stream.
	md.core.ruler.after("block", "wiki_blank_lines", _blank_line_rule)
	md.renderer.rules[BLANK_LINE_TOKEN] = _render_blank_line
	return md


def _inline_plain_text(children) -> str:
	"""
	Flatten inline children to plain text for TOC labels. Like markdown-it's
	renderInlineAsText but it also keeps `code_inline` content, so a heading
	wrapped in backticks (`## `GET /items``) yields "GET /items" instead of an
	empty entry.
	"""
	parts: list[str] = []
	for child in children or []:
		if child.type in ("text", "code_inline"):
			parts.append(child.content)
		elif child.type == "softbreak":
			parts.append(" ")
		elif child.children:
			parts.append(_inline_plain_text(child.children))
	return "".join(parts)


def _apply_heading_slugs_and_toc(tokens) -> list[dict]:
	"""
	Walk parsed tokens, assign unique slug IDs to every heading, and collect
	h2/h3 entries for the table of contents.
	"""
	used: set[str] = set()
	headings: list[dict] = []

	for i, tok in enumerate(tokens):
		if tok.type != "heading_open":
			continue
		inline = tokens[i + 1] if i + 1 < len(tokens) else None
		raw_text = inline.content if inline and inline.type == "inline" else ""

		slug = base = slugify(raw_text) or "heading"
		counter = 1
		while slug in used:
			slug = f"{base}-{counter}"
			counter += 1
		used.add(slug)
		tok.attrSet("id", slug)

		level = int(tok.tag[1])  # "h2" -> 2
		if level in (2, 3):
			# Plain text (markdown syntax dropped) but keeping inline-code labels.
			text = _inline_plain_text(inline.children)
			headings.append({"id": slug, "text": text, "level": level})

	return headings


def render_markdown_with_toc(content: str) -> tuple[str, list]:
	"""
	Convert markdown content to HTML with callout support, and extract TOC headings.

	Args:
	    content: Markdown string to convert

	Returns:
	    Tuple of (HTML string, list of heading dicts with id, text, level)
	"""
	if not content:
		return "", []

	md = _build_markdown()

	processed_content = _encode_image_url_spaces(content)
	processed_content = _escape_table_inline_code_pipes(processed_content)
	processed_content, callouts, callout_prefix = _process_callouts_with_placeholders(processed_content)
	processed_content, videos, video_prefix = _process_videos_with_placeholders(processed_content)
	processed_content, pdfs, pdf_prefix = _process_pdfs_with_placeholders(processed_content)

	env: dict = {}
	tokens = md.parse(processed_content, env)
	headings = _apply_heading_slugs_and_toc(tokens)
	html = md.renderer.render(tokens, md.options, env)

	html = _replace_callout_placeholders(html, callouts, callout_prefix, md.render)
	html = _replace_video_placeholders(html, videos, video_prefix)
	html = _replace_pdf_placeholders(html, pdfs, pdf_prefix)

	if _TABLE_CODE_PIPE_SENTINEL in html:
		html = html.replace(_TABLE_CODE_PIPE_SENTINEL, "|")

	return html, headings


def render_markdown(content: str) -> str:
	"""
	Convert markdown content to HTML with callout support.

	Args:
	    content: Markdown string to convert

	Returns:
	    HTML string
	"""
	html, _ = render_markdown_with_toc(content)
	return html
