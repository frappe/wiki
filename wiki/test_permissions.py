# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

"""Regression tests for the role-based Wiki Space access control helpers.

These cover the full permission matrix the feature promises:
manager / open space / read-role / write-role / wrong-role / Guest, plus the
hook entry points (query conditions + has_permission) and the role editor API.
"""

import frappe
from frappe.tests import IntegrationTestCase

from wiki.permissions import (
	_accessible_space_names,
	_is_manager,
	can_read_space,
	can_write_space,
	wiki_cr_has_permission,
	wiki_document_has_permission,
	wiki_space_has_permission,
)

READER_ROLE = "_Test WSAC Reader"
WRITER_ROLE = "_Test WSAC Writer"
OTHER_ROLE = "_Test WSAC Other"


def _ensure_role(role_name: str) -> None:
	if not frappe.db.exists("Role", role_name):
		frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 0}).insert(
			ignore_permissions=True
		)


def _ensure_user(email: str, roles: list[str]) -> str:
	if not frappe.db.exists("User", email):
		user = frappe.new_doc("User")
		user.email = email
		user.first_name = "WSAC"
		user.send_welcome_email = 0
		user.insert(ignore_permissions=True)
	else:
		user = frappe.get_doc("User", email)

	existing = {r.role for r in user.roles}
	for role in roles:
		if role not in existing:
			user.add_roles(role)
	return email


def _make_space(test_case, name: str, roles: list[tuple[str, str]]) -> str:
	root_group = frappe.get_doc({"doctype": "Wiki Document", "title": f"Root {name}", "is_group": 1}).insert(
		ignore_permissions=True
	)
	test_case._docs.append(root_group.name)

	space = frappe.get_doc(
		{
			"doctype": "Wiki Space",
			"space_name": name,
			"route": frappe.scrub(name).replace("_", "-"),
			"root_group": root_group.name,
		}
	)
	for role, level in roles:
		space.append("roles", {"role": role, "permission_level": level})
	space.insert(ignore_permissions=True)
	test_case._spaces.append(space.name)
	return space.name


class TestWikiSpacePermissions(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		for role in (READER_ROLE, WRITER_ROLE, OTHER_ROLE):
			_ensure_role(role)

		cls.reader = _ensure_user("wsac_reader@example.com", ["Wiki User", READER_ROLE])
		cls.writer = _ensure_user("wsac_writer@example.com", ["Wiki User", WRITER_ROLE])
		cls.outsider = _ensure_user("wsac_outsider@example.com", ["Wiki User", OTHER_ROLE])
		cls.manager = _ensure_user("wsac_manager@example.com", ["Wiki Manager"])
		cls.approver = _ensure_user("wsac_approver@example.com", ["Wiki User", "Wiki Approver"])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

	def setUp(self):
		self._docs = []
		self._spaces = []
		# A space gated to the reader (Read) and writer (Write) roles.
		self.restricted = _make_space(
			self, "WSAC Restricted", [(READER_ROLE, "Read"), (WRITER_ROLE, "Write")]
		)
		# A space with no role rows: open to all logged-in users.
		self.open_space = _make_space(self, "WSAC Open", [])
		# A publicly readable space (built-in Guest role on the read list).
		self.public = _make_space(self, "WSAC Public", [("Guest", "Read")])

	def tearDown(self):
		frappe.set_user("Administrator")
		for space in self._spaces:
			if frappe.db.exists("Wiki Space", space):
				frappe.delete_doc("Wiki Space", space, force=True)
		for doc in reversed(self._docs):
			if frappe.db.exists("Wiki Document", doc):
				frappe.delete_doc("Wiki Document", doc, force=True)

	# --- _is_manager -----------------------------------------------------

	def test_administrator_and_wiki_manager_are_managers(self):
		self.assertTrue(_is_manager("Administrator"))
		self.assertTrue(_is_manager(self.manager))
		self.assertFalse(_is_manager(self.reader))

	# --- can_read_space --------------------------------------------------

	def test_manager_reads_any_space(self):
		self.assertTrue(can_read_space(self.restricted, self.manager))
		self.assertTrue(can_read_space(self.restricted, "Administrator"))

	def test_read_role_grants_read(self):
		self.assertTrue(can_read_space(self.restricted, self.reader))

	def test_write_role_implies_read(self):
		self.assertTrue(can_read_space(self.restricted, self.writer))

	def test_unlisted_role_denied_read_on_restricted_space(self):
		self.assertFalse(can_read_space(self.restricted, self.outsider))

	def test_open_space_readable_by_any_logged_in_user(self):
		self.assertTrue(can_read_space(self.open_space, self.outsider))

	def test_open_space_not_readable_by_guest(self):
		self.assertFalse(can_read_space(self.open_space, "Guest"))

	def test_guest_role_makes_space_publicly_readable(self):
		self.assertTrue(can_read_space(self.public, "Guest"))

	def test_restricted_space_not_readable_by_guest(self):
		self.assertFalse(can_read_space(self.restricted, "Guest"))

	# --- can_write_space -------------------------------------------------

	def test_manager_writes_any_space(self):
		self.assertTrue(can_write_space(self.restricted, self.manager))

	def test_write_role_grants_write(self):
		self.assertTrue(can_write_space(self.restricted, self.writer))

	def test_read_role_does_not_grant_write(self):
		self.assertFalse(can_write_space(self.restricted, self.reader))

	def test_unlisted_role_denied_write(self):
		self.assertFalse(can_write_space(self.restricted, self.outsider))

	def test_open_space_writable_only_by_approver(self):
		self.assertTrue(can_write_space(self.open_space, self.approver))
		self.assertFalse(can_write_space(self.open_space, self.outsider))

	# --- _accessible_space_names ----------------------------------------

	def test_accessible_spaces_for_listed_reader(self):
		names = _accessible_space_names(self.reader)
		self.assertIn(self.restricted, names)
		self.assertIn(self.open_space, names)

	def test_accessible_spaces_excludes_restricted_for_outsider(self):
		names = _accessible_space_names(self.outsider)
		self.assertNotIn(self.restricted, names)
		self.assertIn(self.open_space, names)

	def test_accessible_spaces_for_guest_only_public(self):
		names = _accessible_space_names("Guest")
		self.assertIn(self.public, names)
		self.assertNotIn(self.open_space, names)
		self.assertNotIn(self.restricted, names)

	# --- query-condition filtering via get_list -------------------------

	def test_get_list_filters_restricted_space_for_outsider(self):
		frappe.set_user(self.outsider)
		names = {s.name for s in frappe.get_list("Wiki Space", limit=0)}
		self.assertIn(self.open_space, names)
		self.assertNotIn(self.restricted, names)

	def test_get_list_includes_restricted_space_for_reader(self):
		frappe.set_user(self.reader)
		names = {s.name for s in frappe.get_list("Wiki Space", limit=0)}
		self.assertIn(self.restricted, names)
		self.assertIn(self.open_space, names)

	def test_get_list_unfiltered_for_manager(self):
		frappe.set_user(self.manager)
		names = {s.name for s in frappe.get_list("Wiki Space", limit=0)}
		self.assertIn(self.restricted, names)
		self.assertIn(self.open_space, names)
		self.assertIn(self.public, names)

	# --- has_permission hook entry points -------------------------------

	def test_space_has_permission_read_vs_write(self):
		doc = frappe.get_doc("Wiki Space", self.restricted)
		self.assertTrue(wiki_space_has_permission(doc, "read", self.reader))
		self.assertFalse(wiki_space_has_permission(doc, "write", self.reader))
		self.assertTrue(wiki_space_has_permission(doc, "write", self.writer))
		self.assertFalse(wiki_space_has_permission(doc, "read", self.outsider))

	def test_document_has_permission_delegates_to_space(self):
		doc = frappe.get_doc({"doctype": "Wiki Document", "title": "Gated", "wiki_space": self.restricted})
		self.assertTrue(wiki_document_has_permission(doc, "read", self.reader))
		self.assertFalse(wiki_document_has_permission(doc, "read", self.outsider))
		self.assertFalse(wiki_document_has_permission(doc, "write", self.reader))
		self.assertTrue(wiki_document_has_permission(doc, "write", self.writer))

	def test_orphan_document_readable_by_all_writable_by_manager(self):
		doc = frappe.get_doc({"doctype": "Wiki Document", "title": "Orphan", "wiki_space": None})
		self.assertTrue(wiki_document_has_permission(doc, "read", self.outsider))
		self.assertFalse(wiki_document_has_permission(doc, "write", self.outsider))
		self.assertTrue(wiki_document_has_permission(doc, "write", self.manager))

	def test_cr_has_permission_is_governed_by_space_read(self):
		doc = frappe.get_doc({"doctype": "Wiki Change Request", "wiki_space": self.restricted})
		# Reading and editing (proposing) a CR both require space Read; merge is
		# gated separately in the controller.
		self.assertTrue(wiki_cr_has_permission(doc, "read", self.reader))
		self.assertTrue(wiki_cr_has_permission(doc, "write", self.reader))
		self.assertFalse(wiki_cr_has_permission(doc, "read", self.outsider))


class TestSpaceRolesAPI(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		_ensure_role(READER_ROLE)
		_ensure_role(WRITER_ROLE)
		cls.reader = _ensure_user("wsac_reader@example.com", ["Wiki User", READER_ROLE])
		cls.manager = _ensure_user("wsac_manager@example.com", ["Wiki Manager"])
		frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit

	def setUp(self):
		self._docs = []
		self._spaces = []
		self.space = _make_space(self, "WSAC API", [(READER_ROLE, "Read")])

	def tearDown(self):
		frappe.set_user("Administrator")
		for space in self._spaces:
			if frappe.db.exists("Wiki Space", space):
				frappe.delete_doc("Wiki Space", space, force=True)
		for doc in reversed(self._docs):
			if frappe.db.exists("Wiki Document", doc):
				frappe.delete_doc("Wiki Document", doc, force=True)

	def test_update_space_roles_denied_for_read_tier_user(self):
		from wiki.api.wiki_space import update_space_roles

		frappe.set_user(self.reader)
		with self.assertRaises(frappe.PermissionError):
			update_space_roles(self.space, [{"role": WRITER_ROLE, "permission_level": "Write"}])

	def test_update_space_roles_replaces_rows_for_manager(self):
		from wiki.api.wiki_space import get_space_roles, update_space_roles

		frappe.set_user(self.manager)
		update_space_roles(
			self.space,
			[
				{"role": READER_ROLE, "permission_level": "Read"},
				{"role": WRITER_ROLE, "permission_level": "Write"},
			],
		)
		rows = get_space_roles(self.space)
		levels = {r["role"]: r["permission_level"] for r in rows}
		self.assertEqual(levels, {READER_ROLE: "Read", WRITER_ROLE: "Write"})

	def test_update_space_roles_skips_blank_rows(self):
		from wiki.api.wiki_space import get_space_roles, update_space_roles

		frappe.set_user(self.manager)
		update_space_roles(
			self.space,
			[
				{"role": "", "permission_level": "Read"},
				{"role": READER_ROLE, "permission_level": "Read"},
			],
		)
		rows = get_space_roles(self.space)
		self.assertEqual([r["role"] for r in rows], [READER_ROLE])
