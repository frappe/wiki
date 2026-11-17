import frappe

from wiki.frappe_wiki.doctype.wiki_change_request.patches.archive_empty_drafts import execute
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	create_change_request,
	submit_change_request,
	update_cr_page,
)
from wiki.tests import WikiTestCase
from wiki.tests.factory import WikiFixtureMixin


class TestArchiveEmptyDrafts(WikiFixtureMixin, WikiTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.space = self.wiki.space(pages=[{"title": "Alpha"}])
		self.page_key = frappe.db.get_value(
			"Wiki Document", {"title": "Alpha", "wiki_space": self.space.name}, "doc_key"
		)

	def tearDown(self):
		frappe.db.rollback()

	def status(self, cr):
		return frappe.db.get_value("Wiki Change Request", cr.name, "status")

	def test_archives_an_empty_draft(self):
		empty = create_change_request(self.space.name, f"Draft Changes - {self.space.space_name}")

		execute()

		self.assertEqual(self.status(empty), "Archived")

	def test_keeps_a_draft_with_changes(self):
		edited = create_change_request(self.space.name, f"Draft Changes - {self.space.space_name}")
		update_cr_page(edited.name, self.page_key, {"content": "edited"})

		execute()

		self.assertEqual(self.status(edited), "Draft")

	def test_leaves_submitted_change_requests_alone(self):
		submitted = create_change_request(self.space.name, "Submitted")
		update_cr_page(submitted.name, self.page_key, {"content": "edited"})
		submit_change_request(submitted.name)
		bounced = create_change_request(self.space.name, "Changes requested, empty")
		frappe.db.set_value("Wiki Change Request", bounced.name, "status", "Changes Requested")

		execute()

		self.assertEqual(self.status(submitted), "In Review")
		self.assertEqual(self.status(bounced), "Changes Requested")
