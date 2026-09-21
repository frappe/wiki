# Copyright (c) 2026, Frappe and Contributors
# See license.txt

import re
from pathlib import Path
from unittest.mock import patch

import frappe
import requests
from frappe.tests import IntegrationTestCase

from wiki import telemetry
from wiki.api import og_image
from wiki.api import search as app_search
from wiki.frappe_wiki.doctype.wiki_change_request import wiki_change_request
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	create_change_request,
	merge_change_request,
	update_cr_page,
)
from wiki.frappe_wiki.doctype.wiki_document import search as reader_search
from wiki.frappe_wiki.doctype.wiki_document import wiki_document
from wiki.tests.factory import WikiFixtures
from wiki.wiki import git_sync
from wiki.wiki.doctype.wiki_feedback import wiki_feedback
from wiki.wiki.doctype.wiki_feedback.wiki_feedback import submit_feedback
from wiki.wiki.doctype.wiki_space import wiki_space
from wiki.www import wiki_app


class TestTelemetry(IntegrationTestCase):
	def test_every_event_carries_the_shared_properties(self):
		with patch.object(telemetry.frappe_telemetry, "capture") as capture:
			telemetry.capture("space_created", visibility="public")

		capture.assert_called_once()
		properties = capture.call_args.kwargs["properties"]
		self.assertEqual(capture.call_args.args, ("space_created", "wiki"))
		self.assertEqual(properties["visibility"], "public")
		self.assertEqual(properties["app_version"], frappe.get_attr("wiki.__version__"))
		self.assertIn(properties["entry"], ("saas_trial", "self_hosted"))

	def test_a_failing_send_does_not_fail_the_action(self):
		with patch.object(telemetry.frappe_telemetry, "capture", side_effect=Exception("pulse down")):
			telemetry.capture("space_created")

	def test_the_app_shell_reports_an_active_site_once_a_day(self):
		with patch.object(wiki_app, "capture") as capture:
			wiki_app.get_context()

		capture.assert_called_once_with("active_site", interval="1d")

	def test_a_guest_is_not_an_active_site(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("Guest")

		with patch.object(wiki_app, "capture") as capture:
			wiki_app.get_context()

		capture.assert_not_called()

	def test_the_boot_payload_carries_the_shared_properties(self):
		self.assertEqual(wiki_app.get_boot()["telemetry"], telemetry.default_properties())


class TestShippedEvents(IntegrationTestCase):
	"""One test per Phase 2 event: it fires once, with the properties
	`docs/telemetry.md` promises."""

	def setUp(self):
		self.wiki = WikiFixtures()
		self.addCleanup(self.wiki.destroy_all)

	def test_a_new_space_is_public_unless_it_carries_roles(self):
		with patch.object(wiki_space, "capture") as capture:
			self.wiki.space()

		capture.assert_called_once_with("space_created", visibility="public")

	def test_a_space_with_roles_is_restricted(self):
		with patch.object(wiki_space, "capture") as capture:
			self.wiki.space(roles=[("Wiki Approver", "Read")])

		capture.assert_called_once_with("space_created", visibility="restricted")

	def test_a_git_synced_space_reports_its_sync_too(self):
		with patch.object(wiki_space, "capture") as capture:
			self.wiki.space(git_synced=1, repo_full_name="frappe/wiki", branch="develop")

		self.assertEqual(
			[call.args[0] for call in capture.call_args_list],
			["space_created", "github_sync_enabled"],
		)

	def test_publishing_and_unpublishing_a_space_are_separate_events(self):
		space = self.wiki.space(is_published=0)

		self.wiki.document(parent=space.root_group, title="Page A")

		with patch.object(wiki_space, "capture") as capture:
			space.db_set("is_published", 0)  # no flip, no event
			space.is_published = 1
			space.save()
			space.is_published = 0
			space.save()

		self.assertEqual(
			[call.args[0] for call in capture.call_args_list],
			["space_published", "space_unpublished"],
		)
		properties = capture.call_args_list[0].kwargs
		self.assertEqual(properties["documents"], 1)  # the root group
		self.assertEqual(properties["age_days"], 0)

	def test_a_page_reports_its_kind_and_that_a_person_wrote_it(self):
		space = self.wiki.space()

		with patch.object(wiki_document, "capture") as capture:
			self.wiki.document(parent=space.root_group, title="A Page")

		capture.assert_called_once_with("document_created", kind="page", source="editor")

	def test_document_kinds_are_told_apart(self):
		space = self.wiki.space()
		kinds = {
			"group": {"is_group": 1},
			"tab": {"is_group": 1, "is_tab": 1},
			"external_link": {"is_external_link": 1, "external_url": "https://frappe.io"},
		}

		for expected, fields in kinds.items():
			with patch.object(wiki_document, "capture") as capture:
				self.wiki.document(parent=space.root_group, title=f"A {expected}", **fields)
			self.assertEqual(capture.call_args.kwargs["kind"], expected)

	def test_a_root_group_is_not_an_authored_document(self):
		with patch.object(wiki_document, "capture") as capture:
			self.wiki.space()

		capture.assert_not_called()

	def test_git_sync_is_not_mistaken_for_authoring(self):
		space = self.wiki.space()

		frappe.flags.in_wiki_git_sync = True
		self.addCleanup(lambda: frappe.flags.pop("in_wiki_git_sync", None))
		with patch.object(wiki_document, "capture") as capture:
			self.wiki.document(parent=space.root_group, title="From the repo")

		self.assertEqual(capture.call_args.kwargs["source"], "git_sync")

	def test_a_change_request_reports_its_creation(self):
		space = self.wiki.space(pages=[{"title": "Page A"}])

		with patch.object(wiki_change_request, "capture") as capture:
			create_change_request(space.name, "CR")

		capture.assert_called_once_with("change_request_created")

	def test_a_merge_reports_its_size_and_whether_anyone_reviewed_it(self):
		space = self.wiki.space(pages=[{"title": "Page A"}])
		page = frappe.get_value("Wiki Document", {"wiki_space": space.name, "is_group": 0}, "doc_key")
		cr = create_change_request(space.name, "CR")
		update_cr_page(cr.name, page, {"content": "v2"})

		with patch.object(wiki_change_request, "capture") as capture:
			frappe.db.set_value("Wiki Change Request", cr.name, "status", "Approved")
			merge_change_request(cr.name)

		capture.assert_called_once_with("change_request_merged", items=1, reviewed=False, conflicts=False)

	def test_a_merge_someone_else_approved_is_reviewed(self):
		space = self.wiki.space(pages=[{"title": "Page A"}])
		page = frappe.get_value("Wiki Document", {"wiki_space": space.name, "is_group": 0}, "doc_key")
		cr = create_change_request(space.name, "CR")
		update_cr_page(cr.name, page, {"content": "v2"})
		frappe.db.set_value(
			"Wiki Change Request",
			cr.name,
			{"status": "Approved", "owner": "Guest", "reviewed_by": frappe.session.user},
		)

		with patch.object(wiki_change_request, "capture") as capture:
			merge_change_request(cr.name)

		self.assertTrue(capture.call_args.kwargs["reviewed"])

	def test_feedback_reports_its_sentiment_and_nothing_anyone_wrote(self):
		space = self.wiki.space(pages=[{"title": "Page A"}])
		document = frappe.get_value("Wiki Document", {"wiki_space": space.name, "is_group": 0})

		with patch.object(wiki_feedback, "capture") as capture:
			submit_feedback(wiki_document=document, type="Good", feedback="Loved it")

		capture.assert_called_once_with("feedback_submitted", sentiment="good", has_comment=True)

	def test_a_legacy_star_rating_lands_on_the_same_scale(self):
		space = self.wiki.space(pages=[{"title": "Page A"}])
		document = frappe.get_value("Wiki Document", {"wiki_space": space.name, "is_group": 0})
		feedback = frappe.get_doc({"doctype": "Wiki Feedback", "wiki_document": document, "rating": 0.4})

		with patch.object(wiki_feedback, "capture") as capture:
			self.wiki.track("Wiki Feedback", feedback.insert())

		capture.assert_called_once_with("feedback_submitted", sentiment="bad", has_comment=False)

	def test_an_app_search_is_a_daily_event_that_records_whether_it_hit(self):
		self.wiki.space(pages=[{"title": "Findable"}])

		with patch.object(app_search, "capture") as capture:
			app_search.search_pages("findable")

		capture.assert_called_once_with("search_performed", interval="1d", surface="app", hits=True)

	def test_a_reader_search_reports_the_other_surface(self):
		with patch.object(reader_search, "capture") as capture:
			reader_search.search("nothing-matches-this")

		capture.assert_called_once_with("search_performed", interval="1d", surface="reader", hits=False)

	def test_a_failed_sync_reports_the_kind_of_error_never_the_message(self):
		space = self.wiki.space(git_synced=1, repo_full_name="frappe/wiki", branch="develop")

		with (
			patch.object(git_sync, "_fetch_head_sha", side_effect=requests.ConnectionError("boom")),
			patch.object(git_sync, "capture") as capture,
		):
			git_sync.sync_space(space.name)

		capture.assert_called_once_with("github_sync_failed", error_kind="network", trigger="manual")

	def test_a_rendered_card_reports_its_outcome_and_cost(self):
		with (
			patch.object(og_image, "generate_og_bytes", return_value=b"png"),
			patch.object(og_image, "_write_cached"),
			patch.object(og_image, "_prune_old"),
			patch.object(og_image, "capture") as capture,
		):
			og_image._generate_and_store("k1", {}, "fp", "/tmp/card.png", trigger="request")

		capture.assert_called_once_with(
			"meta_image_generated", outcome="ok", trigger="request", duration_bucket="lt_1s"
		)

	def test_a_card_that_could_not_render_is_reported_as_failed(self):
		with (
			patch.object(og_image, "generate_og_bytes", side_effect=Exception("chromium died")),
			patch.object(og_image, "capture") as capture,
		):
			with self.assertRaises(og_image.CardFailed):
				og_image._generate_and_store("k2", {}, "fp", "/tmp/card.png", trigger="warm")

		self.assertEqual(capture.call_args.kwargs["outcome"], "failed")
		self.assertEqual(capture.call_args.kwargs["trigger"], "warm")


class TestEventCatalogue(IntegrationTestCase):
	def test_every_event_the_code_sends_is_documented(self):
		app_root = Path(frappe.get_app_path("wiki")).parent
		catalogue = (app_root / "docs" / "telemetry.md").read_text()

		sources = list((app_root / "wiki").rglob("*.py"))
		for suffix in ("*.js", "*.vue"):
			sources += list((app_root / "frontend" / "src").rglob(suffix))
		sent = set()
		for source in sources:
			if "test" in source.name:
				continue
			sent.update(re.findall(r"capture\(\s*[\"']([a-z_]+)[\"']", source.read_text()))

		undocumented = {event for event in sent if f"`{event}`" not in catalogue}
		self.assertEqual(undocumented, set(), "add these to docs/telemetry.md")
