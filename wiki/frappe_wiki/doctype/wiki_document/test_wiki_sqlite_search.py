from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase
from frappe.utils import now_datetime

from wiki.frappe_wiki.doctype.wiki_document.wiki_sqlite_search import WikiSQLiteSearch, rebuild_index
from wiki.tests import WikiTestCase
from wiki.tests.factory import make_document, make_space


def indexed_text(markdown: str) -> str:
	page = frappe._dict(
		doctype="Wiki Document",
		name="search-page",
		title="Search Page",
		content=markdown,
		route="space/search-page",
		is_published=1,
		modified=now_datetime(),
	)
	with patch.object(WikiSQLiteSearch, "_get_root_space", return_value="space"):
		return WikiSQLiteSearch().prepare_document(page)["content"]


class TestIndexedContent(UnitTestCase):
	def assert_indexed(self, markdown: str, *expected: str):
		text = indexed_text(markdown)
		for term in expected:
			self.assertIn(term, text.split(), msg=text)

	def test_keeps_inline_code(self):
		self.assert_indexed("Set `host_name` here", "host_name", "Set", "here")

	def test_keeps_inline_code_in_a_table(self):
		self.assert_indexed("| Key |\n| --- |\n| `host_name` |", "host_name")

	def test_keeps_fenced_code(self):
		self.assert_indexed("```python\nfenced_value = 1\n```", "fenced_value")

	def test_url_in_inline_code_keeps_the_text_after_it(self):
		markdown = (
			'| Key | Note |\n| --- | --- |\n| `first_key` | `"https://erp.example.org:2424"` |\n'
			"| `second_key` | Second description |\n| `third_key` | Third description |"
		)
		self.assert_indexed(markdown, "first_key", "second_key", "third_key", "Second", "Third")

	def test_stray_backtick_keeps_the_text_after_it(self):
		self.assertEqual(indexed_text("it`s one `two` three `four` five"), "it s one two three four` five")

	def test_absolute_link_keeps_the_text_after_it(self):
		markdown = "[label](https://example.org/a) first second (third) fourth"
		self.assert_indexed(markdown, "label", "first", "second", "(third)", "fourth")

	def test_absolute_image_keeps_the_text_after_it(self):
		markdown = "![diagram](https://example.org/a.png) first (second) third"
		self.assert_indexed(markdown, "diagram", "first", "(second)", "third")

	def test_keeps_image_alt_text(self):
		self.assert_indexed("![architecture diagram](/files/a.png)", "architecture", "diagram")

	def test_keeps_visible_urls(self):
		self.assert_indexed("See https://erp.example.org/setup now", "https://erp.example.org/setup")

	def test_keeps_snake_case_words(self):
		self.assert_indexed(
			"Use alpha_beta_gamma and first_key with second_key",
			"alpha_beta_gamma",
			"first_key",
			"second_key",
		)

	def test_keeps_dunder_names_and_asterisks_in_code(self):
		self.assert_indexed("Call `__init__` and `a*b*c`", "__init__", "a*b*c")

	def test_keeps_placeholders_in_code(self):
		self.assert_indexed("Run `bench --site <sitename> migrate`", "sitename", "migrate")

	def test_removes_markdown_syntax(self):
		text = indexed_text("## Heading\n\n**bold** _italic_ ~~gone~~\n\n> quote\n\n- item")
		self.assertEqual(text, "Heading bold italic gone quote item")

	def test_keeps_custom_callout_titles_only(self):
		text = indexed_text(":::note\nDefault body\n:::\n\n:::tip[Deploy checklist]\nCustom body\n:::")
		self.assertEqual(text, "Default body Deploy checklist Custom body")

	def test_skips_text_readers_cannot_see(self):
		text = indexed_text(
			'Visible <!-- comment_text --> <span title="attribute_text">words</span>\n\n'
			"<script>script_text()</script>\n\n[label](https://hidden-target.example.org)"
		)
		self.assertEqual(text, "Visible words label")

	def test_code_samples_cannot_become_markup_in_snippets(self):
		text = indexed_text("`<img src=x onerror=alert(1)>`\n\n```html\n<script>alert(2)</script>\n```")
		self.assertNotIn("<", text)
		self.assertNotIn(">", text)
		self.assertIn("onerror=alert(1)", text)


class TestRebuildIndex(WikiTestCase):
	def test_rebuild_makes_code_searchable_and_drops_deleted_pages(self):
		space = make_space()
		page = make_document(parent=space.root_group, title="Rebuild", content="Set `rebuild_probe_key` here")
		search = WikiSQLiteSearch()
		search.drop_index()
		search.build_index()
		search._index_documents(
			[
				{
					**search.prepare_document(page.reload()),
					"id": "Wiki Document:deleted-page",
					"name": "deleted-page",
				}
			]
		)

		rebuild_index()

		names = [result["name"] for result in WikiSQLiteSearch().search("rebuild_probe_key")["results"]]
		self.assertEqual(names, [page.name])
