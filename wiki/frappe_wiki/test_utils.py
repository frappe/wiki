import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.utils import lucide_svg


class TestLucideSvg(FrappeTestCase):
	"""The public reader inlines tab icons server-side; these guard the promise
	that a tab icon can never render as an empty box."""

	def test_known_icon_inlines_its_markup(self):
		svg = lucide_svg("lucide-house")
		self.assertIn("<svg", svg)
		self.assertIn("<path", svg)

	def test_unknown_icon_falls_back_to_non_empty_svg(self):
		svg = lucide_svg("lucide-not-a-real-icon")
		self.assertIn("<svg", svg)
		# lucide-hash fallback — never an empty string.
		self.assertTrue(svg.strip())

	def test_none_icon_still_returns_non_empty_svg(self):
		self.assertIn("<svg", lucide_svg(None))

	def test_survives_a_missing_lookup_table(self):
		# Even with no generated table at all, the baked-in fallback renders.
		from wiki import utils

		utils._lucide_table.cache_clear()
		original = frappe.get_app_path
		frappe.get_app_path = lambda *a, **k: "/nonexistent/lucide_icons.json"
		try:
			svg = lucide_svg("lucide-house")
		finally:
			frappe.get_app_path = original
			utils._lucide_table.cache_clear()
		self.assertIn("<svg", svg)
		self.assertIn("<line", svg)
