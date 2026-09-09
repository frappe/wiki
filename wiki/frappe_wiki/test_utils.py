import frappe
from frappe.tests.utils import FrappeTestCase

from wiki.utils import (
	DEFAULT_SPACE_ICON,
	SPACE_COLORS,
	lucide_svg,
	space_color_theme,
	space_mark,
)


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


class TestSpaceMark(FrappeTestCase):
	"""The reader resolves a space's identity with its own copy of the rules in
	`frontend/src/lib/spaceIdentity.js`. These guard the two things a copy can
	get wrong: the priority order, and the colour a space with no colour gets.
	"""

	SVG = "data:image/svg+xml;utf8,<svg/>"

	def _space(self, **fields):
		return {
			"name": "SPACE-1",
			"space_name": "Engineering",
			"avatar": "",
			"space_icon": "",
			"space_color": "",
			"app_switcher_logo": "",
			**fields,
		}

	def test_a_generated_mark_wins_over_an_icon_and_a_logo(self):
		mark = space_mark(
			self._space(avatar=self.SVG, space_icon="lucide-rocket", app_switcher_logo="/files/a.png")
		)
		self.assertEqual(mark["mode"], "avatar")
		self.assertEqual(mark["image"], self.SVG)

	def test_an_icon_wins_over_a_logo(self):
		mark = space_mark(self._space(space_icon="lucide-rocket", app_switcher_logo="/files/a.png"))
		self.assertEqual(mark["mode"], "icon")
		self.assertEqual(mark["icon"], "lucide-rocket")

	def test_a_logo_is_the_last_image(self):
		mark = space_mark(self._space(app_switcher_logo="/files/a.png"))
		self.assertEqual(mark["mode"], "logo")
		self.assertEqual(mark["image"], "/files/a.png")

	def test_a_space_with_no_mark_falls_back_to_its_initial(self):
		mark = space_mark(self._space())
		self.assertEqual(mark["mode"], "initial")
		self.assertEqual(mark["initial"], "E")

	def test_an_unusable_avatar_falls_through_rather_than_drawing_nothing(self):
		for value in ('<svg onload="alert(1)"/>', "data:text/html,<script>", "javascript:alert(1)"):
			with self.subTest(value=value):
				self.assertEqual(space_mark(self._space(avatar=value))["mode"], "initial")

	def test_an_icon_outside_the_curated_set_still_draws_something(self):
		mark = space_mark(self._space(space_icon="rocket"))
		self.assertEqual(mark["icon"], DEFAULT_SPACE_ICON)

	def test_an_off_palette_colour_resolves_to_one_that_exists(self):
		self.assertIn(space_mark(self._space(space_color="fuchsia"))["color"], SPACE_COLORS)

	def test_a_derived_colour_matches_the_app(self):
		"""The two hashes must agree, or a space is one colour in the app and
		another on its own page. These expectations are what
		`spaceColorTheme('', name)` returns in the browser."""
		for name, expected in (("SPACE-1", "red"), ("05hi0prpqb", "violet"), ("", "gray")):
			with self.subTest(name=name):
				self.assertEqual(space_color_theme("", name), expected)
