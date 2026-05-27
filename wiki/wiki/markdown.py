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

# SVG icons for each callout type
CALLOUT_ICONS = {
	"note": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
	"tip": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
	"caution": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
	"danger": '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
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

	return (
		f'<aside class="callout callout-{callout_type}">\n'
		f'<span class="callout-icon">{icon}</span>\n'
		f'<div class="callout-body">\n'
		f'<span class="callout-title">{title}</span>\n'
		f'<div class="callout-content">{inner_html}</div>\n'
		f"</div>\n"
		f"</aside>"
	)


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
		return f"\n\n{placeholder_prefix}{idx}END\n\n"

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


SCRIPT_TAG_PATTERN = re.compile(r"(?is)<script\b[^>]*>.*?</script>|</?script\b[^>]*>")


def _remove_script_tags(value: str | None) -> str:
	"""Remove only <script> tags/content; keep all other HTML unchanged."""
	if not value:
		return ""
	return SCRIPT_TAG_PATTERN.sub("", str(value))


# Match full-line markdown image syntax with optional title:
# ![alt](url) or ![alt](url "title")
VIDEO_MARKDOWN_PATTERN = re.compile(
	r'^!\[(?P<alt>[^\]]*)\]\((?P<url>[^)"\s]+)(?:\s+"(?P<title>[^"]*)")?\)[ \t]*$',
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
		return f"\n\n{placeholder_prefix}{idx}END\n\n"

	return VIDEO_MARKDOWN_PATTERN.sub(replacer, content), videos, placeholder_prefix


def _replace_video_placeholders(html: str, videos: list[dict], placeholder_prefix: str) -> str:
	"""Replace video placeholders with block video HTML."""
	for idx, video in enumerate(videos):
		placeholder = f"{placeholder_prefix}{idx}END"
		video_html = _generate_video_html(video["url"], video["alt"], video["title"])
		html = html.replace(f"<p>{placeholder}</p>", video_html)
		html = html.replace(placeholder, video_html)
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


def _build_markdown() -> MarkdownIt:
	"""Build a configured markdown-it-py instance with our render overrides."""
	md = (
		MarkdownIt("commonmark", {"html": True, "linkify": False, "typographer": False})
		.enable(["table", "strikethrough"])
		.use(footnote_plugin)
		.use(tasklists_plugin, enabled=True)
	)

	def _render_codeblock_html(content: str, lang: str = "") -> str:
		# Trim trailing whitespace the author left inside the fence — spaces,
		# tabs, and blank lines all render as phantom empty rows in <pre>.
		content = content.rstrip() + "\n"
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
		s = f'<img src="{src}" alt="{alt}"'
		if title:
			s += f' title="{title}"'
		return s + " />"

	md.renderer.rules["image"] = image_render
	return md


def _apply_heading_slugs_and_toc(tokens, md: MarkdownIt) -> list[dict]:
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
			# Render the inline as plain text so TOC entries drop markdown syntax
			text = md.renderer.renderInlineAsText(inline.children or [], md.options, {})
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

	env: dict = {}
	tokens = md.parse(processed_content, env)
	headings = _apply_heading_slugs_and_toc(tokens, md)
	html = md.renderer.render(tokens, md.options, env)

	html = _replace_callout_placeholders(html, callouts, callout_prefix, md.render)
	html = _replace_video_placeholders(html, videos, video_prefix)

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
