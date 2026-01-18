# Copyright (c) 2025, Frappe and Contributors
# See license.txt

import unittest

from wiki.wiki.markdown import render_markdown, render_markdown_with_toc


class TestMarkdownRenderer(unittest.TestCase):
	"""Tests for the custom markdown renderer."""

	def test_basic_markdown(self):
		"""Test basic markdown rendering."""
		result = render_markdown("**bold** and *italic*")
		self.assertIn("<strong>bold</strong>", result)
		self.assertIn("<em>italic</em>", result)

	def test_empty_content(self):
		"""Test empty content returns empty string."""
		self.assertEqual(render_markdown(""), "")
		self.assertEqual(render_markdown(None), "")

	def test_headings(self):
		"""Test heading rendering with slugified IDs."""
		result = render_markdown("# Heading 1\n## Heading 2")
		self.assertIn('<h1 id="heading-1">Heading 1</h1>', result)
		self.assertIn('<h2 id="heading-2">Heading 2</h2>', result)

	def test_links(self):
		"""Test link rendering."""
		result = render_markdown("[Link text](https://example.com)")
		self.assertIn('href="https://example.com"', result)
		self.assertIn("Link text", result)


class TestHeadingSlugGeneration(unittest.TestCase):
	"""Tests for heading ID/slug generation."""

	def test_heading_slug_basic(self):
		"""Test basic heading slug generation."""
		result = render_markdown("## What is ERPNext?")
		self.assertIn('<h2 id="what-is-erpnext">What is ERPNext?</h2>', result)

	def test_heading_slug_with_spaces(self):
		"""Test heading with spaces gets hyphenated slug."""
		result = render_markdown("## Getting Started Guide")
		self.assertIn('<h2 id="getting-started-guide">Getting Started Guide</h2>', result)

	def test_heading_slug_lowercase(self):
		"""Test heading slug is lowercase."""
		result = render_markdown("## UPPERCASE HEADING")
		self.assertIn('<h2 id="uppercase-heading">UPPERCASE HEADING</h2>', result)

	def test_heading_slug_removes_special_chars(self):
		"""Test heading slug removes special characters."""
		result = render_markdown("## What's New? (2024)")
		self.assertIn('<h2 id="whats-new-2024">What\'s New? (2024)</h2>', result)

	def test_heading_slug_duplicate_handling(self):
		"""Test duplicate headings get unique slugs."""
		content = """## Introduction
## Details
## Introduction
## Introduction"""
		result = render_markdown(content)
		self.assertIn('<h2 id="introduction">Introduction</h2>', result)
		self.assertIn('<h2 id="details">Details</h2>', result)
		self.assertIn('<h2 id="introduction-1">Introduction</h2>', result)
		self.assertIn('<h2 id="introduction-2">Introduction</h2>', result)

	def test_heading_slug_all_levels(self):
		"""Test slug generation works for all heading levels."""
		content = """# Level One
## Level Two
### Level Three
#### Level Four
##### Level Five
###### Level Six"""
		result = render_markdown(content)
		self.assertIn('<h1 id="level-one">Level One</h1>', result)
		self.assertIn('<h2 id="level-two">Level Two</h2>', result)
		self.assertIn('<h3 id="level-three">Level Three</h3>', result)
		self.assertIn('<h4 id="level-four">Level Four</h4>', result)
		self.assertIn('<h5 id="level-five">Level Five</h5>', result)
		self.assertIn('<h6 id="level-six">Level Six</h6>', result)

	def test_heading_slug_unicode(self):
		"""Test heading with unicode characters."""
		result = render_markdown("## Café Setup")
		self.assertIn('<h2 id="café-setup">Café Setup</h2>', result)

	def test_heading_slug_numbers(self):
		"""Test heading with numbers."""
		result = render_markdown("## Step 1: Install")
		self.assertIn('<h2 id="step-1-install">Step 1: Install</h2>', result)

	def test_heading_slug_collapses_hyphens(self):
		"""Test multiple spaces/special chars collapse to single hyphen."""
		result = render_markdown("## Hello   ---   World")
		self.assertIn('<h2 id="hello-world">Hello   ---   World</h2>', result)


class TestImageCaptionSupport(unittest.TestCase):
	"""Tests for image caption support in markdown.

	Captions use the Stack Overflow pattern:
	![alt text](image.jpg)
	*caption text*

	This renders as <p><img ...><em>caption</em></p> (no blank line between).
	The alt text is for accessibility; caption is separate emphasized text.
	"""

	def test_image_with_caption_pattern(self):
		"""Test image with caption on next line (no blank line)."""
		# No blank line between image and caption
		content = """![Alt text](/files/test.jpg)
*This is the caption*"""
		result = render_markdown(content)

		# Should have image with alt
		self.assertIn('<img src="/files/test.jpg"', result)
		self.assertIn('alt="Alt text"', result)

		# Should have em for caption (styled via CSS img + em)
		self.assertIn("<em>This is the caption</em>", result)

		# Should NOT have figure/figcaption (old pattern)
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

	def test_image_without_caption(self):
		"""Test that images without caption render as simple img tags."""
		result = render_markdown("![](/files/test.jpg)")

		# Should NOT have figure wrapper
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

		# Should have simple image
		self.assertIn('<img src="/files/test.jpg"', result)

	def test_image_with_title(self):
		"""Test that images with title attribute render correctly."""
		result = render_markdown('![Alt text](/files/test.jpg "Image title")')

		# Should have image with alt and title
		self.assertIn('alt="Alt text"', result)
		self.assertIn('title="Image title"', result)

		# Should NOT have figure/figcaption
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

	def test_image_alt_escapes_html(self):
		"""Test that alt text is properly escaped."""
		result = render_markdown("![<script>alert('xss')</script>](/files/test.jpg)")

		# Script tags should be escaped, not rendered as HTML
		self.assertNotIn("<script>alert", result)

	def test_multiple_images_with_captions(self):
		"""Test multiple images with captions."""
		content = """![First image](/files/first.jpg)
*Caption for first image*

Some text between images.

![Second image](/files/second.jpg)
*Caption for second image*"""
		result = render_markdown(content)

		# Both images should be rendered
		self.assertIn('<img src="/files/first.jpg"', result)
		self.assertIn('<img src="/files/second.jpg"', result)

		# Both captions should be in em tags
		self.assertIn("<em>Caption for first image</em>", result)
		self.assertIn("<em>Caption for second image</em>", result)

	def test_image_caption_separated_by_blank_line(self):
		"""Test that blank line between image and caption separates them."""
		# Blank line between image and caption - they become separate paragraphs
		content = """![Alt text](/files/test.jpg)

*This is NOT a caption, just italic text*"""
		result = render_markdown(content)

		# Both should render, but in separate paragraphs
		self.assertIn('<img src="/files/test.jpg"', result)
		self.assertIn("<em>This is NOT a caption, just italic text</em>", result)


class TestCalloutRendering(unittest.TestCase):
	"""Tests for callout/aside rendering.

	Note: Callouts use a preprocessing step before markdown rendering.
	The callout must start at the beginning of a line in the document.
	"""

	def test_note_callout(self):
		"""Test note callout rendering."""
		# Callout must be at start of document or after blank line
		content = """:::note
This is a note
:::
"""
		result = render_markdown(content)
		self.assertIn("callout-note", result)
		self.assertIn("This is a note", result)

	def test_tip_callout(self):
		"""Test tip callout rendering."""
		content = """:::tip
This is a tip
:::
"""
		result = render_markdown(content)
		self.assertIn("callout-tip", result)

	def test_caution_callout(self):
		"""Test caution callout rendering."""
		content = """:::caution
Be careful
:::
"""
		result = render_markdown(content)
		self.assertIn("callout-caution", result)

	def test_danger_callout(self):
		"""Test danger callout rendering."""
		content = """:::danger
Dangerous!
:::
"""
		result = render_markdown(content)
		self.assertIn("callout-danger", result)

	def test_warning_callout_maps_to_caution(self):
		"""Test warning is alias for caution."""
		content = """:::warning
Warning text
:::
"""
		result = render_markdown(content)
		self.assertIn("callout-caution", result)

	def test_callout_with_custom_title(self):
		"""Test callout with custom title."""
		content = """:::note[Custom Title]
Content
:::
"""
		result = render_markdown(content)
		self.assertIn("Custom Title", result)


class TestComplexMarkdownContent(unittest.TestCase):
	"""Tests for complex markdown content with callouts and images."""

	def test_markdown_with_callouts_and_images(self):
		"""Test markdown content with callouts and images that have spaces in URLs.

		The renderer should automatically URL-encode spaces in image URLs.
		"""
		# Note: URLs have UNENCODED spaces - the renderer should handle this
		content = """## Method 1: Download and Install from Windows PC (USB)

:::note
This is the recommended method for Windows users
:::

:::warning
You need a USB drive with at least 8GB of storage for this method.
:::

Once you have installed the app, you will need to set up your account. Visit your newly created site that has the app installed, and you should see a setup wizard.

![Screenshot 2024-05-16 at 3.55.11 PM](/files/Screenshot 2024-05-16 at 3.55.11 PM.png)
*Setup wizard screenshot*

To complete the setup you will need to enter basic information like your country, name, email, and password. Make sure to remember your email and password as this is going to be your admin account.

Once you complete the setup wizard, you will be redirected to the workspace of the Learning app. The top section of the workspace provides some important quick links. You can visit the Learning Portal and start setting up your very first course. The workspace also has some important charts. They show the count of daily signups and enrollments on the LMS.

![Screenshot 2024-05-16 at 3.57.40 PM](/files/Screenshot 2024-05-16 at 3.57.40 PM.png)
*Workspace screenshot*

Some text after."""

		result = render_markdown(content)

		# Check headings (with slugified ID)
		self.assertIn(
			'<h2 id="method-1-download-and-install-from-windows-pc-usb">Method 1: Download and Install from Windows PC (USB)</h2>',
			result,
		)

		# Check callouts
		self.assertIn("callout-note", result)
		self.assertIn("This is the recommended method for Windows users", result)
		self.assertIn("callout-caution", result)  # warning maps to caution
		self.assertIn("You need a USB drive with at least 8GB of storage for this method.", result)

		# Check images are rendered (spaces in URLs automatically encoded to %20)
		self.assertIn('<img src="/files/Screenshot%202024-05-16%20at%203.55.11%20PM.png"', result)
		self.assertIn('alt="Screenshot 2024-05-16 at 3.55.11 PM"', result)

		self.assertIn('<img src="/files/Screenshot%202024-05-16%20at%203.57.40%20PM.png"', result)
		self.assertIn('alt="Screenshot 2024-05-16 at 3.57.40 PM"', result)

		# Check captions are rendered as em tags
		self.assertIn("<em>Setup wizard screenshot</em>", result)
		self.assertIn("<em>Workspace screenshot</em>", result)

		# Should NOT use figure/figcaption pattern
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

		# Ensure images are NOT rendered as broken !<a> syntax
		self.assertNotIn("!<a href=", result)
		self.assertNotIn(">Screenshot 2024-05-16 at 3.55.11 PM</a>", result)


class TestImageUrlSpaceEncoding(unittest.TestCase):
	"""Tests for automatic URL-encoding of spaces in image URLs."""

	def test_simple_image_with_spaces(self):
		"""Test that spaces in image URLs are automatically encoded."""
		content = "![My Image](/files/my image.png)"
		result = render_markdown(content)

		self.assertIn('<img src="/files/my%20image.png"', result)
		self.assertIn('alt="My Image"', result)
		self.assertNotIn("![My Image]", result)

		# Should NOT use figure/figcaption
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

	def test_image_with_title_and_spaces(self):
		"""Test image with title attribute and spaces in URL."""
		content = '![Alt Text](/files/path with spaces/image.png "Image Title")'
		result = render_markdown(content)

		self.assertIn('<img src="/files/path%20with%20spaces/image.png"', result)
		self.assertIn('alt="Alt Text"', result)
		self.assertIn('title="Image Title"', result)

		# Should NOT use figure/figcaption
		self.assertNotIn("<figure", result)
		self.assertNotIn("<figcaption", result)

	def test_already_encoded_url_unchanged(self):
		"""Test that already URL-encoded URLs are not double-encoded."""
		content = "![My Image](/files/my%20image.png)"
		result = render_markdown(content)

		# Should not double-encode %20 to %2520
		self.assertIn('<img src="/files/my%20image.png"', result)
		self.assertNotIn("%2520", result)


class TestRawHTMLRendering(unittest.TestCase):
	"""Tests for raw HTML rendering in markdown.

	HTML should pass through without being escaped when escape=False
	is configured on the renderer.
	"""

	def test_raw_html_div_not_escaped(self):
		"""Test that raw HTML div tags are not escaped."""
		content = '<div align="center"><img src="/files/hero-image.png"></div>'
		result = render_markdown(content)

		# HTML should be preserved, not escaped
		self.assertIn('<div align="center">', result)
		self.assertIn('<img src="/files/hero-image.png">', result)

		# Should NOT contain escaped HTML entities
		self.assertNotIn("&lt;div", result)
		self.assertNotIn("&gt;", result)
		self.assertNotIn("&quot;", result)

	def test_raw_html_with_style(self):
		"""Test that raw HTML with style attributes is preserved."""
		content = '<div style="margin: 0 0 0 0;"><img src="/files/test.png"></div>'
		result = render_markdown(content)

		self.assertIn('<div style="margin: 0 0 0 0;">', result)
		self.assertNotIn("&lt;", result)

	def test_inline_html_in_markdown(self):
		"""Test inline HTML mixed with markdown."""
		content = """# Heading

Some paragraph text.

<div align="center">
<img src="/files/centered-image.png">
</div>

More text after."""
		result = render_markdown(content)

		self.assertIn('<h1 id="heading">Heading</h1>', result)
		self.assertIn('<div align="center">', result)
		self.assertIn('<img src="/files/centered-image.png">', result)
		self.assertIn("</div>", result)
		self.assertNotIn("&lt;div", result)

	def test_html_span_not_escaped(self):
		"""Test that span tags are not escaped."""
		content = 'Text with <span style="color: red;">colored</span> word.'
		result = render_markdown(content)

		self.assertIn('<span style="color: red;">colored</span>', result)
		self.assertNotIn("&lt;span", result)


class TestTableRendering(unittest.TestCase):
	"""Tests for table rendering."""

	def test_basic_table(self):
		"""Test basic table rendering."""
		content = """
| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
"""
		result = render_markdown(content)
		self.assertIn("<table>", result)
		self.assertIn("<th>", result)
		self.assertIn("<td>", result)


class TestTaskListRendering(unittest.TestCase):
	"""Tests for task list rendering."""

	def test_task_list(self):
		"""Test task list rendering."""
		content = """
- [ ] Unchecked item
- [x] Checked item
"""
		result = render_markdown(content)
		self.assertIn('type="checkbox"', result)


class TestTOCGeneration(unittest.TestCase):
	"""Tests for Table of Contents (TOC) heading extraction."""

	def test_toc_extracts_h2_headings(self):
		"""Test that h2 headings are extracted for TOC."""
		content = """## Introduction
Some text.
## Getting Started
More text.
## Conclusion
Final text."""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 3)
		self.assertEqual(headings[0]["text"], "Introduction")
		self.assertEqual(headings[0]["id"], "introduction")
		self.assertEqual(headings[0]["level"], 2)
		self.assertEqual(headings[1]["text"], "Getting Started")
		self.assertEqual(headings[2]["text"], "Conclusion")

	def test_toc_extracts_h3_headings(self):
		"""Test that h3 headings are extracted for TOC."""
		content = """## Main Section
### Subsection 1
### Subsection 2"""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 3)
		self.assertEqual(headings[0]["level"], 2)
		self.assertEqual(headings[1]["level"], 3)
		self.assertEqual(headings[2]["level"], 3)

	def test_toc_excludes_h1_and_h4_plus(self):
		"""Test that h1 and h4+ headings are NOT included in TOC."""
		content = """# Title (h1 - excluded)
## Section (h2 - included)
### Subsection (h3 - included)
#### Deep Section (h4 - excluded)
##### Even Deeper (h5 - excluded)"""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 2)
		self.assertEqual(headings[0]["text"], "Section (h2 - included)")
		self.assertEqual(headings[1]["text"], "Subsection (h3 - included)")

	def test_toc_empty_for_no_headings(self):
		"""Test that empty list is returned when no h2/h3 headings."""
		content = """Just some paragraph text.

More text here.

# Only an h1 heading"""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 0)

	def test_toc_empty_for_empty_content(self):
		"""Test that empty content returns empty list."""
		html, headings = render_markdown_with_toc("")
		self.assertEqual(html, "")
		self.assertEqual(headings, [])

	def test_toc_handles_duplicate_headings(self):
		"""Test that duplicate headings get unique IDs in TOC."""
		content = """## Introduction
## Details
## Introduction
## Introduction"""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 4)
		ids = [h["id"] for h in headings]
		self.assertEqual(ids[0], "introduction")
		self.assertEqual(ids[1], "details")
		self.assertEqual(ids[2], "introduction-1")
		self.assertEqual(ids[3], "introduction-2")

	def test_toc_preserves_heading_text(self):
		"""Test that heading text is preserved correctly."""
		content = "## What's New? (2024)"
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 1)
		self.assertEqual(headings[0]["text"], "What's New? (2024)")
		self.assertEqual(headings[0]["id"], "whats-new-2024")

	def test_toc_with_mixed_content(self):
		"""Test TOC extraction with complex content including callouts."""
		content = """## Getting Started

:::note
This is a note callout.
:::

Some regular paragraph text.

### Prerequisites

- Item 1
- Item 2

### Installation

Code block example.

## Advanced Usage

More content here."""
		html, headings = render_markdown_with_toc(content)

		self.assertEqual(len(headings), 4)
		self.assertEqual(headings[0]["text"], "Getting Started")
		self.assertEqual(headings[0]["level"], 2)
		self.assertEqual(headings[1]["text"], "Prerequisites")
		self.assertEqual(headings[1]["level"], 3)
		self.assertEqual(headings[2]["text"], "Installation")
		self.assertEqual(headings[2]["level"], 3)
		self.assertEqual(headings[3]["text"], "Advanced Usage")
		self.assertEqual(headings[3]["level"], 2)

	def test_toc_html_matches_render_markdown(self):
		"""Test that HTML output is identical to render_markdown."""
		content = """## Heading One
Some text.
## Heading Two
More text."""
		html_with_toc, headings = render_markdown_with_toc(content)
		html_only = render_markdown(content)

		self.assertEqual(html_with_toc, html_only)

	def test_toc_heading_ids_match_html(self):
		"""Test that TOC heading IDs match the IDs in rendered HTML."""
		content = """## First Section
## Second Section
### Nested Section"""
		html, headings = render_markdown_with_toc(content)

		for heading in headings:
			# Verify each heading ID exists in the HTML
			expected_tag = f'<h{heading["level"]} id="{heading["id"]}">'
			self.assertIn(expected_tag, html)


if __name__ == "__main__":
	unittest.main()
