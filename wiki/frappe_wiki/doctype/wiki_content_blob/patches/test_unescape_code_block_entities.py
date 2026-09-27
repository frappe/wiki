# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import hashlib

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from wiki.frappe_wiki.doctype.wiki_content_blob.patches.unescape_code_block_entities import (
	execute,
	unescape_code_blocks,
)
from wiki.frappe_wiki.doctype.wiki_revision.wiki_revision import create_revision_from_live_tree
from wiki.tests.factory import make_space


def fence(code: str, marker: str = "```") -> str:
	return f"{marker}js\n{code}\n{marker}\n"


class TestUnescapeCodeBlocks(UnitTestCase):
	def test_decodes_entities_inside_a_fence(self):
		content = fence("fetch('http://&lt;base-url&gt;/api?a=1&amp;b=2').then(r =&gt; r)")

		self.assertEqual(
			unescape_code_blocks(content),
			fence("fetch('http://<base-url>/api?a=1&b=2').then(r => r)"),
		)

	def test_decodes_tilde_and_indented_fences(self):
		content = "1. Step\n\n   ~~~\n   a &lt; b\n   ~~~\n"

		self.assertEqual(unescape_code_blocks(content), "1. Step\n\n   ~~~\n   a < b\n   ~~~\n")

	def test_leaves_entities_outside_code_alone(self):
		content = "Go to **Apps &gt; Desk**, and use `&lt;br&gt;`.\n"

		self.assertEqual(unescape_code_blocks(content), content)

	def test_decodes_a_half_fixed_fence(self):
		content = fence("if (a &amp;&amp; b) {\n  go(() => a);\n}")

		self.assertEqual(unescape_code_blocks(content), fence("if (a && b) {\n  go(() => a);\n}"))

	def test_decodes_double_escape_one_level(self):
		self.assertEqual(unescape_code_blocks(fence("&amp;lt;")), fence("&lt;"))

	def test_leaves_prose_between_fences_alone(self):
		content = fence("a &lt; b") + "\nApps &gt; Desk\n\n" + fence("x &gt; y")

		self.assertEqual(
			unescape_code_blocks(content), fence("a < b") + "\nApps &gt; Desk\n\n" + fence("x > y")
		)


class TestUnescapeCodeBlockEntitiesPatch(IntegrationTestCase):
	def test_fixes_live_content_and_revision_blobs(self):
		marker = frappe.generate_hash(length=10)
		space = make_space(pages=[{"title": "REST API", "content": fence(f"curl http://&lt;{marker}&gt;")}])
		document = frappe.get_all(
			"Wiki Document", filters={"parent_wiki_document": space.root_group}, pluck="name"
		)[0]
		revision = create_revision_from_live_tree(space.name, ignore_permissions=True)
		blob = frappe.db.get_value(
			"Wiki Revision Item",
			{"revision": revision.name, "content_blob": ("is", "set"), "is_group": 0},
			"content_blob",
		)

		execute()

		expected = fence(f"curl http://<{marker}>")
		self.assertEqual(frappe.db.get_value("Wiki Document", document, "content"), expected)
		blob_content, blob_hash = frappe.db.get_value("Wiki Content Blob", blob, ["content", "hash"])
		self.assertEqual(blob_content, expected)
		self.assertEqual(blob_hash, hashlib.sha256(expected.encode()).hexdigest())
		self.assertEqual(frappe.db.get_value("Wiki Revision", revision.name, "hashes_stale"), 1)
