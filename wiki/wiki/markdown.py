"""
Custom Markdown Renderer with Callout/Aside Support

This module provides a custom markdown-to-HTML renderer using Mistune,
with support for Astro Starlight-style callouts/asides.

Syntax:
    :::note
    Content here
    :::

    :::tip[Custom Title]
    Content with custom title
    :::

Supported types: note, tip, caution, danger, warning (alias for caution)
"""

import re
from urllib.parse import quote

import mistune


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
	# Replace spaces and underscores with hyphens
	text = re.sub(r"[\s_]+", "-", text)
	# Remove characters that aren't alphanumerics, hyphens, or unicode letters
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
	r"^:::(?P<type>note|tip|caution|danger|warning)(?:\\?\[(?P<title>[^\]]*)\])?\s*\n(?P<content>[\s\S]*?)\n:::[ \t]*$",
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
	# Use HTML comment-like placeholder that won't be parsed as markdown
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
		# Return placeholder - use format that won't be parsed as markdown
		return f"\n\n{placeholder_prefix}{idx}END\n\n"

	# Process callouts (may be nested, so we process iteratively)
	prev_content = None
	while prev_content != content:
		prev_content = content
		content = CALLOUT_PATTERN.sub(replacer, content)

	return content, callouts, placeholder_prefix


def _replace_callout_placeholders(html, callouts, placeholder_prefix, md_instance):
	"""Replace callout placeholders with actual HTML after markdown rendering."""
	for idx, callout in enumerate(callouts):
		placeholder = f"{placeholder_prefix}{idx}END"
		# The placeholder might be wrapped in <p> tags, so handle both cases
		inner_html = md_instance(callout["content"]) if callout["content"] else ""
		callout_html = _generate_callout_html(callout["type"], callout["title"], inner_html)

		# Replace placeholder (may be wrapped in <p> tags)
		html = html.replace(f"<p>{placeholder}</p>", callout_html)
		html = html.replace(placeholder, callout_html)

	return html


# Pattern to match markdown image syntax: ![alt](url) or ![alt](url "title")
# Captures: alt text, URL, and optional title
IMAGE_PATTERN = re.compile(
	r'!\[([^\]]*)\]\(([^)"\s]+(?:\s[^)]*)?)\)',
)


def _encode_image_url_spaces(content: str) -> str:
	"""
	Pre-process markdown to URL-encode spaces in image URLs.

	Mistune (unlike markdown2) doesn't handle spaces in URLs, so we need to
	encode them before parsing. This function finds all image syntax and
	encodes spaces in the URL portion.

	Args:
	    content: Markdown string

	Returns:
	    Markdown string with spaces in image URLs encoded as %20
	"""

	def encode_url(match):
		alt_text = match.group(1)
		url_part = match.group(2)

		# Split URL and optional title (title is in quotes after a space)
		# e.g., '/path/to/image.png "Image Title"'
		title_match = re.match(r'^([^"]+?)(?:\s+"([^"]*)")?$', url_part)
		if title_match:
			url = title_match.group(1).strip()
			title = title_match.group(2)
		else:
			url = url_part
			title = None

		# Only encode spaces, preserve other characters
		# quote() with safe='' would encode everything, but we only want spaces
		encoded_url = url.replace(" ", "%20")

		# Reconstruct the image syntax
		if title:
			return f'![{alt_text}]({encoded_url} "{title}")'
		return f"![{alt_text}]({encoded_url})"

	return IMAGE_PATTERN.sub(encode_url, content)


class WikiRenderer(mistune.HTMLRenderer):
	"""Custom HTML renderer.

	Image captions use the Stack Overflow pattern:
	    ![alt text](image.jpg)
	    *caption text*

	This renders as <p><img ...><em>caption</em></p> (no blank line between).
	Style with CSS: img + em { ... }
	Alt text remains for accessibility, caption is separate.
	"""

	def __init__(self, **kwargs):
		super().__init__(**kwargs)
		self._heading_slugs = {}  # Track used slugs to avoid duplicates
		self._headings = []  # Track headings for TOC

	def heading(self, text: str, level: int, **attrs) -> str:
		"""Render heading with slugified ID for anchor links."""
		# Generate base slug from heading text
		slug = slugify(text)

		# Handle empty slugs
		if not slug:
			slug = "heading"

		# Ensure unique slugs by appending numbers for duplicates
		original_slug = slug
		counter = 1
		while slug in self._heading_slugs:
			slug = f"{original_slug}-{counter}"
			counter += 1

		self._heading_slugs[slug] = True

		# Track h2 and h3 headings for TOC
		if level in (2, 3):
			self._headings.append({"id": slug, "text": text, "level": level})

		return f'<h{level} id="{slug}">{text}</h{level}>\n'

	def get_headings(self) -> list:
		"""Return the list of h2/h3 headings extracted during rendering."""
		return self._headings


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

	# Create a base Mistune markdown instance with custom renderer
	# Note: escape=False must be passed to the renderer, not create_markdown
	renderer = WikiRenderer(escape=False)
	md = mistune.create_markdown(
		renderer=renderer,
		plugins=[
			"strikethrough",
			"footnotes",
			"table",
			"task_lists",
		],
	)

	# Step 1: URL-encode spaces in image URLs (mistune doesn't handle them)
	processed_content = _encode_image_url_spaces(content)

	# Step 2: Extract callouts and replace with placeholders
	processed_content, callouts, placeholder_prefix = _process_callouts_with_placeholders(processed_content)

	# Step 3: Render markdown (placeholders will be wrapped in <p> tags)
	html = md(processed_content)

	# Step 4: Replace placeholders with actual callout HTML
	html = _replace_callout_placeholders(html, callouts, placeholder_prefix, md)

	# Get the headings extracted during rendering
	headings = renderer.get_headings()

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
