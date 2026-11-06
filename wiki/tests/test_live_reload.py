from unittest.mock import patch

import frappe

from wiki.api.wiki_space import get_sync_sha
from wiki.tests import WikiTestCase
from wiki.tests.factory import make_document, make_space


class TestReaderLiveReload(WikiTestCase):
	"""In developer mode, reader pages of git-synced spaces reload after a sync."""

	def setUp(self):
		self.synced = make_space(git_synced=1, roles=[("Guest", "Read")])
		frappe.db.set_value("Wiki Space", self.synced.name, "last_synced_commit_sha", "abc123")
		self.page = make_document(parent=self.synced.root_group, title="Install")
		developer_mode = patch.dict(frappe.conf, {"developer_mode": 1})
		developer_mode.start()
		self.addCleanup(developer_mode.stop)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def test_page_context_carries_the_space_and_its_sync(self):
		live_reload = self.page.get_web_context()["live_reload"]
		self.assertEqual(live_reload, {"space": self.synced.name, "sha": "abc123"})

	def test_guest_reads_the_sync_of_a_public_synced_space(self):
		frappe.set_user("Guest")
		self.assertEqual(get_sync_sha(self.synced.name), "abc123")

	def test_nothing_without_developer_mode(self):
		with patch.dict(frappe.conf, {"developer_mode": 0}):
			self.assertIsNone(self.page.get_web_context()["live_reload"])
			self.assertIsNone(get_sync_sha(self.synced.name))

	def test_nothing_for_a_space_that_is_not_synced(self):
		space = make_space(roles=[("Guest", "Read")])
		page = make_document(parent=space.root_group, title="Handwritten")
		self.assertIsNone(page.get_web_context()["live_reload"])
		self.assertIsNone(get_sync_sha(space.name))

	def test_guest_gets_nothing_for_a_private_space(self):
		private = make_space(git_synced=1, roles=[("System Manager", "Read")])
		frappe.db.set_value("Wiki Space", private.name, "last_synced_commit_sha", "secret")
		frappe.set_user("Guest")
		self.assertIsNone(get_sync_sha(private.name))
