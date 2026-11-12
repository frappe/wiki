import frappe
from frappe.core.doctype.user_permission.test_user_permission import create_user

from wiki.api.history import get_page_history, get_revision_changes, get_space_history
from wiki.frappe_wiki.doctype.wiki_change_request.wiki_change_request import (
	create_change_request,
	merge_change_request,
	update_cr_page,
)
from wiki.tests import WikiTestCase as IntegrationTestCase
from wiki.tests.factory import make_space


def merge_edit(space, title, doc_key, fields):
	cr = create_change_request(space.name, title)
	update_cr_page(cr.name, doc_key, fields)
	frappe.db.set_value("Wiki Change Request", cr.name, "status", "Approved")
	merge_change_request(cr.name)
	return cr


class TestHistory(IntegrationTestCase):
	def tearDown(self):
		frappe.db.rollback()

	def setUp(self):
		self.space = make_space(
			pages=[{"title": "Install", "content": "Run bench"}, {"title": "FAQ", "content": "Ask"}]
		)
		self.install, self.faq = (
			frappe.get_value(
				"Wiki Document", {"title": title, "parent_wiki_document": self.space.root_group}, "doc_key"
			)
			for title in ("Install", "FAQ")
		)

	def test_page_history_keeps_only_revisions_that_changed_the_page(self):
		edit = merge_edit(self.space, "Explain the bench", self.install, {"content": "Run bench init"})
		merge_edit(self.space, "Answer more", self.faq, {"content": "Ask away"})
		rename = merge_edit(self.space, "Rename install", self.install, {"title": "Installation"})

		history = get_page_history(self.space.name, self.install)

		self.assertFalse(history["more"])
		self.assertEqual(
			[(v["change_request"], v["source"], v["changes"]) for v in history["versions"]],
			[
				(rename.name, "merge", ["renamed"]),
				(edit.name, "merge", ["edited"]),
				(None, "initial", ["added"]),
			],
		)
		self.assertEqual(history["versions"][0]["old_title"], "Install")
		self.assertEqual(history["versions"][0]["change_request_title"], "Rename install")
		self.assertEqual(history["versions"][0]["author"]["user"], "Administrator")

	def test_space_history_counts_the_pages_each_version_changed(self):
		edit = merge_edit(self.space, "Explain the bench", self.install, {"content": "Run bench init"})

		history = get_space_history(self.space.name)

		self.assertEqual(
			[(v["change_request"], v["page_count"]) for v in history["versions"]],
			[(edit.name, 1), (None, 2)],
		)

	def test_history_pages_newest_first(self):
		for n in range(3):
			merge_edit(self.space, f"Edit {n}", self.install, {"content": f"Version {n}"})

		first = get_page_history(self.space.name, self.install, start=0, limit=2)
		rest = get_page_history(self.space.name, self.install, start=2, limit=2)

		self.assertTrue(first["more"])
		self.assertEqual([v["change_request_title"] for v in first["versions"]], ["Edit 2", "Edit 1"])
		self.assertEqual([v["change_request_title"] for v in rest["versions"]], ["Edit 0", None])
		self.assertFalse(rest["more"])

	def test_revision_changes_diff_against_the_previous_version(self):
		merge_edit(self.space, "Explain the bench", self.install, {"content": "Run **bench init**"})
		version = get_page_history(self.space.name, self.install)["versions"][0]

		(page,) = get_revision_changes(version["revision"], self.install)["pages"]

		self.assertEqual(page["change_type"], "modified")
		self.assertEqual(page["base"]["content"], "Run bench")
		self.assertIn("<strong>bench init</strong>", page["head"]["html"])

	def test_revision_changes_refuse_a_change_request_working_copy(self):
		cr = create_change_request(self.space.name, "Unfinished")

		with self.assertRaises(frappe.DoesNotExistError):
			get_revision_changes(cr.head_revision)

	def test_history_refuses_an_outsider(self):
		space = make_space(roles=[("Wiki Manager", "Read")], pages=[{"title": "Secret"}])
		create_change_request(space.name, "Seed the chain")
		revision = frappe.get_value("Wiki Space", space.name, "main_revision")
		doc_key = frappe.get_value(
			"Wiki Document", {"title": "Secret", "parent_wiki_document": space.root_group}, "doc_key"
		)

		frappe.set_user(create_user("history-outsider@example.com", "Wiki User").name)
		try:
			for call in (
				lambda: get_page_history(space.name, doc_key),
				lambda: get_space_history(space.name),
				lambda: get_revision_changes(revision),
			):
				with self.assertRaises(frappe.PermissionError):
					call()
		finally:
			frappe.set_user("Administrator")
