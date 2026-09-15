import frappe
from frappe.tests import IntegrationTestCase

from wiki.api.search import search_pages
from wiki.test_permissions import _ensure_role, _ensure_user
from wiki.tests.factory import make_space, unique_route

READER_ROLE = "_Test Page Search Reader"
TOKEN = "Zephyrquill"


def _titles(query: str) -> set[str]:
	return {row.title for row in search_pages(query)}


class TestSearchPages(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_ensure_role(READER_ROLE)
		cls.reader = _ensure_user("page_search_reader@example.com", ["Wiki User", READER_ROLE])
		cls.outsider = _ensure_user("page_search_outsider@example.com", ["Wiki User"])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

	def setUp(self):
		open_route = unique_route()
		self.open_space = make_space(
			space_name=f"{TOKEN} Open",
			route=open_route,
			pages=[
				{"title": "Onboarding", "route": f"{open_route}/{TOKEN.lower()}-howto"},
				{"title": f"{TOKEN} Deploys"},
				{"title": f"{TOKEN} Draft", "is_published": 0},
				{"title": f"{TOKEN} Guides", "children": [{"title": f"{TOKEN} Nested"}]},
				{"title": f"{TOKEN} Link", "is_external_link": 1, "external_url": "https://example.com"},
			],
		)
		self.restricted_space = make_space(
			space_name=f"{TOKEN} Restricted",
			roles=[(READER_ROLE, "Read")],
			pages=[{"title": f"{TOKEN} Secret"}],
		)

	def tearDown(self):
		frappe.set_user("Administrator")
		for space in (self.open_space, self.restricted_space):
			frappe.delete_doc("Wiki Space", space.name, force=True)

	def test_matches_the_route_with_spaces_as_hyphens(self):
		self.assertIn(f"{TOKEN} Deploys", _titles("zephyrquill dep"))
		self.assertIn("Onboarding", _titles(f"{TOKEN}-HOWTO"))
		self.assertEqual(_titles("   "), set())

	def test_ignores_the_title(self):
		self.assertNotIn("Onboarding", _titles("Onboarding"))

	def test_ignores_the_space_segment_of_the_route(self):
		self.assertEqual(_titles(self.open_space.route), set())

	def test_returns_the_space_the_palette_labels_a_hit_with(self):
		row = search_pages(f"{TOKEN} Deploys")[0]
		self.assertEqual(row.wiki_space, self.open_space.name)
		self.assertEqual(row.space_name, f"{TOKEN} Open")
		self.assertEqual(row.space_route, self.open_space.route)

	def test_excludes_groups_and_external_links(self):
		titles = _titles(TOKEN)
		self.assertIn(f"{TOKEN} Nested", titles)
		self.assertNotIn(f"{TOKEN} Guides", titles)
		self.assertNotIn(f"{TOKEN} Link", titles)

	def test_includes_unpublished_pages(self):
		self.assertIn(f"{TOKEN} Draft", _titles(TOKEN))

	def test_hides_restricted_space_from_outsider(self):
		frappe.set_user(self.outsider)
		titles = _titles(TOKEN)
		self.assertIn(f"{TOKEN} Deploys", titles)
		self.assertNotIn(f"{TOKEN} Secret", titles)

	def test_shows_restricted_space_to_reader(self):
		frappe.set_user(self.reader)
		self.assertIn(f"{TOKEN} Secret", _titles(TOKEN))
