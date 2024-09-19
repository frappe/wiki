import re

import frappe
import six
from bs4 import Comment, Doctype, NavigableString
from markdownify import MarkdownConverter

html_heading_re = re.compile(r"h[1-6]")


class CustomMarkdownConverter(MarkdownConverter):
	# override markdownify's process_tag function to escape certain html tags instead of removing them
	def process_tag(self, node, convert_as_inline, children_only=False):
		text = ""

		# markdown headings or cells can't include
		# block elements (elements w/newlines)
		isHeading = html_heading_re.match(node.name) is not None
		isCell = node.name in ["td", "th"]
		convert_children_as_inline = convert_as_inline

		if not children_only and (isHeading or isCell):
			convert_children_as_inline = True

		# Remove whitespace-only textnodes in purely nested nodes
		def is_nested_node(el):
			return el and el.name in ["ol", "ul", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th"]

		if is_nested_node(node):
			for el in node.children:
				# Only extract (remove) whitespace-only text node if any of the
				# conditions is true:
				# - el is the first element in its parent
				# - el is the last element in its parent
				# - el is adjacent to an nested node
				can_extract = (
					not el.previous_sibling
					or not el.next_sibling
					or is_nested_node(el.previous_sibling)
					or is_nested_node(el.next_sibling)
				)
				if isinstance(el, NavigableString) and six.text_type(el).strip() == "" and can_extract:
					el.extract()

		# Convert the children first
		for el in node.children:
			if isinstance(el, Comment) or isinstance(el, Doctype):
				continue
			elif isinstance(el, NavigableString):
				text += self.process_text(el)
			else:
				if el.name in ["video", "iframe", "audio", "embed", "object", "source", "picture", "math"]:
					text += self.process_text(el)

				processed_tag = self.process_tag(el, convert_children_as_inline)
				if processed_tag is not None:  # Ensure it doesn't return None
					text += processed_tag

		if not children_only:
			convert_fn = getattr(self, f"convert_{node.name}", None)
			if convert_fn and self.should_convert_tag(node.name):
				text = convert_fn(node, text, convert_as_inline)

		return text

	def convert_img(self, el, text, convert_as_inline):
		alt = el.attrs.get("alt", None) or ""
		src = el.attrs.get("src", None) or ""
		title = el.attrs.get("title", None) or ""
		title_part = ' "{}"'.format(title.replace('"', r"\"")) if title else ""

		# Only include image tags with valid src attribute, this is to remove empty image tags added by Prosemirror
		if not src or src.strip() == "":
			return ""

		if convert_as_inline and el.parent.name not in self.options["keep_inline_images_in"]:
			return alt

		return f"![{alt}]({src}{title_part})"


def custom_markdownify(html, **options):
	return CustomMarkdownConverter(**options).convert(html)


def execute():
	wiki_pages = frappe.db.get_all("Wiki Page", fields=["name", "content"])
	for page in wiki_pages:
		markdown_content = custom_markdownify(page["content"]).replace("`", "&#96;").replace("${", "&#36;{")
		frappe.db.set_value("Wiki Page", page["name"], "content", markdown_content)
