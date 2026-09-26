# Copyright (c) 2026, Frappe and Contributors
# See license.txt

from frappe.tests import UnitTestCase

from wiki.frappe_wiki.doctype.wiki_content_blob.patches.strip_underline_markers import (
	strip_underline_markers,
)


class TestStripUnderlineMarkers(UnitTestCase):
	def test_strips_underlined_text(self):
		self.assertEqual(
			strip_underline_markers("++Based on duration++: We use cookies."),
			"Based on duration: We use cookies.",
		)

	def test_strips_underlined_links(self):
		self.assertEqual(
			strip_underline_markers("see ++**[read here](https://x.io/a)**++) and"),
			"see **[read here](https://x.io/a)**) and",
		)
		self.assertEqual(
			strip_underline_markers("[docs](++https://x.io/v4/++)."),
			"[docs](https://x.io/v4/).",
		)
		self.assertEqual(
			strip_underline_markers("available at++[SLA](https://x.io/sla)++ (terms)"),
			"available at[SLA](https://x.io/sla) (terms)",
		)

	def test_keeps_plus_signs_that_are_not_underline(self):
		for content in (
			"Written in C++ and C++ again.",
			"Use `i++` and `++i` here.",
			"```js\nfor (;;) { ++a++ }\n```",
			"a ++ b ++ c",
			"![img](data:image/png;base64,ab++cd++ef++)",
		):
			self.assertEqual(strip_underline_markers(content), content)
