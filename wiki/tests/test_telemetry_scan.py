# Copyright (c) 2026, Frappe and Contributors
# See license.txt

from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from wiki import telemetry_scan
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import create_change_request
from wiki.tests.factory import WikiFixtures


class TestSiteProfileConsent(IntegrationTestCase):
	def test_a_site_with_telemetry_off_is_never_scanned(self):
		with (
			patch.object(telemetry_scan, "is_pulse_enabled", return_value=False),
			patch.object(telemetry_scan, "collect") as collect,
			patch.object(telemetry_scan, "capture") as capture,
		):
			telemetry_scan.send_site_profile()

		collect.assert_not_called()
		capture.assert_not_called()

	def test_the_scan_sends_one_event(self):
		with (
			patch.object(telemetry_scan, "is_pulse_enabled", return_value=True),
			patch.object(telemetry_scan, "capture") as capture,
		):
			telemetry_scan.send_site_profile()

		capture.assert_called_once()
		self.assertEqual(capture.call_args.args, ("site_profile",))
		properties = capture.call_args.kwargs
		self.assertIn("spaces", properties)
		self.assertIn("documents", properties)

	def test_the_profile_fits_in_one_pulse_row(self):
		self.assertLess(len(frappe.as_json(telemetry_scan.collect())), 4096)


class TestSiteProfileCounts(IntegrationTestCase):
	"""The profile counts the whole site, so each test asserts the difference
	its own fixtures made."""

	def setUp(self):
		self.wiki = WikiFixtures()
		self.addCleanup(self.wiki.destroy_all)
		self.before = telemetry_scan.collect()

	def delta(self, key: str) -> int:
		return telemetry_scan.collect()[key] - self.before[key]

	def test_spaces_are_counted_by_what_they_turn_on(self):
		off = {"allow_contributions": 0, "enable_feedback_collection": 0}
		self.wiki.space(is_published=1, enable_tabs=1, **off)
		self.wiki.space(is_published=0, allow_contributions=1, enable_feedback_collection=1)
		self.wiki.space(roles=[("Wiki Approver", "Read")], **off)
		self.wiki.space(git_synced=1, repo_full_name="frappe/wiki", branch="develop", **off)

		self.assertEqual(self.delta("spaces"), 4)
		self.assertEqual(self.delta("published_spaces"), 3)
		self.assertEqual(self.delta("restricted_spaces"), 1)
		self.assertEqual(self.delta("github_synced_spaces"), 1)
		self.assertEqual(self.delta("spaces_with_tabs"), 1)
		self.assertEqual(self.delta("spaces_accepting_contributions"), 1)
		self.assertEqual(self.delta("spaces_with_feedback_on"), 1)

	def test_documents_are_counted_by_kind_and_a_root_group_is_not_one(self):
		space = self.wiki.space(
			pages=[
				{"title": "A Page"},
				{"title": "A Group", "children": [{"title": "Nested", "is_published": 0}]},
				{"title": "A Tab", "is_tab": 1, "is_group": 1},
				{"title": "A Link", "is_external_link": 1, "external_url": "https://frappe.io"},
			]
		)

		self.assertTrue(space.root_group)
		self.assertEqual(self.delta("documents"), 5)
		self.assertEqual(self.delta("published_documents"), 4)
		self.assertEqual(self.delta("documents_group"), 1)
		self.assertEqual(self.delta("documents_tab"), 1)
		self.assertEqual(self.delta("documents_external_link"), 1)

	def test_a_block_counts_the_space_that_uses_it_not_every_page(self):
		self.wiki.space(
			pages=[
				{"title": "One", "content": "```mermaid\nflowchart TD\n  A --> B\n```"},
				{"title": "Two", "content": "```mermaid\nflowchart TD\n  C --> D\n```"},
			]
		)
		self.wiki.space(
			pages=[
				{"title": "Three", "content": ":::note\nRead this\n:::"},
				{"title": "Four", "content": "![Spec](/files/spec.pdf)"},
				{"title": "Five", "content": "| A | B |\n| --- | --- |\n| 1 | 2 |"},
			]
		)

		self.assertEqual(self.delta("blocks_mermaid"), 1)
		self.assertEqual(self.delta("blocks_callout"), 1)
		self.assertEqual(self.delta("blocks_pdf"), 1)
		self.assertEqual(self.delta("blocks_image"), 1)
		self.assertEqual(self.delta("blocks_table"), 1)

	def test_a_mark_is_counted_once_in_the_order_the_reader_resolves_it(self):
		spaces = [
			frappe._dict(avatar="data:image/svg+xml,<svg/>", avatar_style="waves", space_icon="lucide-book"),
			frappe._dict(space_icon="lucide-book", app_switcher_logo="/files/logo.png"),
			frappe._dict(app_switcher_logo="/files/logo.png"),
			frappe._dict(),
		]

		counts = telemetry_scan.mark_counts(
			[
				frappe._dict(
					{"avatar": "", "space_icon": "", "app_switcher_logo": "", "avatar_style": "", **space}
				)
				for space in spaces
			]
		)

		self.assertEqual(counts["avatar_generated"], 1)
		self.assertEqual(counts["avatar_icon"], 1)
		self.assertEqual(counts["avatar_logo"], 1)
		self.assertEqual(counts["avatar_waves"], 1)
		self.assertEqual(counts["avatar_glass"], 0)

	def test_change_requests_are_split_by_whether_they_are_still_open(self):
		space = self.wiki.space(pages=[{"title": "A Page"}])
		for status in ("Draft", "In Review", "Merged", "Rejected"):
			request = create_change_request(space.name, "CR")
			frappe.db.set_value("Wiki Change Request", request.name, "status", status)

		self.assertEqual(self.delta("change_requests_open"), 2)
		self.assertEqual(self.delta("change_requests_merged"), 1)

	def test_an_editor_counts_once_however_many_revisions_they_wrote(self):
		space = self.wiki.space(pages=[{"title": "A Page"}])
		for _ in range(2):
			revision = frappe.get_doc(
				{"doctype": "Wiki Revision", "wiki_space": space.name, "created_by": "Administrator"}
			)
			revision.insert(ignore_permissions=True)

		self.assertLessEqual(self.delta("editors_last_30d"), 1)


class TestSiteProfileShape(IntegrationTestCase):
	def test_the_spread_is_a_median_and_a_max_never_a_list(self):
		self.assertEqual(
			telemetry_scan.spread([1, 4, 9]),
			{"documents_per_space_median": 4, "documents_per_space_max": 9},
		)
		self.assertEqual(
			telemetry_scan.spread([]),
			{"documents_per_space_median": 0, "documents_per_space_max": 0},
		)

	def test_a_site_that_never_ingested_a_view_still_reports(self):
		with patch.object(telemetry_scan.analytics_store, "site_activity", side_effect=Exception("no file")):
			counts = telemetry_scan.people_counts()

		self.assertEqual(counts["views_last_30d"], 0)
		self.assertEqual(counts["viewers_last_30d"], 0)

	def test_every_property_the_profile_sends_is_documented(self):
		app_root = Path(frappe.get_app_path("wiki")).parent
		catalogue = (app_root / "docs" / "telemetry.md").read_text()

		undocumented = {key for key in telemetry_scan.collect() if f"`{key}`" not in catalogue}
		self.assertEqual(undocumented, set(), "add these to docs/telemetry.md")
