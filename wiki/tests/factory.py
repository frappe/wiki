"""Shared wiki fixtures for the Python test suite.

The counterpart of ``e2e/helpers/factory.ts``, with the same vocabulary: a
space is described in one call and its page tree is nested.

Four test modules each grew their own ``create_test_wiki_space`` /
``create_test_wiki_document`` before this existed, and they had drifted apart
on titles, on published defaults and on what they tracked. They now delegate
here and keep only their own bookkeeping.
"""

import frappe


def unique_route(prefix: str = "test-space") -> str:
	return f"{prefix}-{frappe.generate_hash(length=8)}"


def _insert(doc):
	"""Insert regardless of who the test is currently logged in as.

	``ignore_permissions`` is sticky -- ``insert`` stores it on the document --
	so a fixture inserted this way would carry a permission bypass into any
	later ``save()`` the test makes on the same object. Clear it, or a test
	asserting that a regular user *cannot* save gets a silent pass.
	"""
	doc.insert(ignore_permissions=True)
	doc.flags.ignore_permissions = False
	return doc


def make_space(pages: list[dict] | None = None, roles: list[tuple[str, str]] | None = None, **fields):
	"""Create a Wiki Space, and optionally a tree of pages under it.

	Prefer letting the space make its own root group: ``before_insert`` does it,
	and the group it makes is what ``on_trash`` cascades. An explicit
	``root_group`` is honoured -- several suites build one so they can parent
	documents before the space exists -- but then that document is yours to
	delete.
	"""
	route = fields.pop("route", None) or unique_route()
	space = frappe.get_doc(
		{
			"doctype": "Wiki Space",
			"route": route,
			"space_name": fields.pop("space_name", None) or route,
			"is_published": fields.pop("is_published", 1),
			**fields,
		}
	)
	for role, level in roles or []:
		space.append("roles", {"role": role, "permission_level": level})
	_insert(space)

	for spec in pages or []:
		make_document(parent=space.root_group, **spec)
	return space


def make_document(
	parent: str | None = None, title: str = "Test Page", children: list[dict] | None = None, **fields
):
	"""Create a Wiki Document under ``parent``, then its ``children``."""
	doc = frappe.get_doc(
		{
			"doctype": "Wiki Document",
			"title": title,
			"parent_wiki_document": parent,
			"is_group": 1 if (fields.pop("is_group", False) or children) else 0,
			"is_published": fields.pop("is_published", 1),
			"content": fields.pop("content", f"Content for {title}"),
			**fields,
		}
	)
	_insert(doc)

	for spec in children or []:
		make_document(parent=doc.name, **spec)
	return doc


class WikiFixtures:
	"""``make_space`` / ``make_document`` plus the bookkeeping to undo them.

	A space is deleted through ``Wiki Space.on_trash``, which cascades its
	document tree, revisions, revision items, sync logs and change requests --
	so a document inside a space needs no separate tracking.
	"""

	def __init__(self):
		self._spaces: list[str] = []
		self._documents: list[str] = []
		self._others: list[tuple[str, str]] = []

	def space(self, pages: list[dict] | None = None, **kwargs):
		return self.track_space(make_space(pages=pages, **kwargs))

	def document(self, parent: str | None = None, **kwargs):
		return self.track_document(make_document(parent=parent, **kwargs))

	def track_space(self, space):
		"""Adopt a space this factory did not create, so it is destroyed too."""
		self._spaces.append(space.name if hasattr(space, "name") else space)
		return space

	def track_document(self, doc):
		"""Adopt a document this factory did not create."""
		self._documents.append(doc.name if hasattr(doc, "name") else doc)
		return doc

	def track(self, doctype: str, doc):
		"""Adopt a row of any other doctype -- a legacy ``Wiki Page``, say."""
		self._others.append((doctype, doc.name if hasattr(doc, "name") else doc))
		return doc

	@staticmethod
	def snapshot_documents() -> set[str]:
		"""Every Wiki Document that exists right now. Pair with ``track_new``."""
		return set(frappe.get_all("Wiki Document", pluck="name", limit=0))

	def track_new(self, before: set[str]):
		"""Adopt every Wiki Document that appeared since ``before``.

		For code under test that creates documents itself -- the v3 migrations
		build them from legacy Wiki Pages, and the orphan pass parents them
		nowhere, so no space's on-trash cascade can reach them.
		"""
		for name in self.snapshot_documents() - before:
			self._documents.append(name)

	@staticmethod
	def _leaf_first(names: list[str]) -> list[str]:
		"""Order documents so no parent is deleted before its children.

		Insertion order is not enough: ``track_new`` adopts whatever the code
		under test created, in whatever order the query returned it, and the
		nested set refuses to delete a node that still has children.
		"""
		rows = (
			frappe.get_all(
				"Wiki Document",
				filters={"name": ["in", names]},
				fields=["name", "lft", "rgt"],
				limit=0,
			)
			if names
			else []
		)
		rows.sort(key=lambda r: (r.rgt or 0) - (r.lft or 0))
		ordered = [r.name for r in rows]
		# Anything the query no longer sees (already gone) keeps its place last.
		return ordered + [n for n in names if n not in set(ordered)]

	def destroy_all(self):
		"""Delete everything this factory made. Safe to call more than once."""
		previous_flag = frappe.flags.in_apply_merge_revision
		frappe.flags.in_apply_merge_revision = True
		try:
			for name in self._leaf_first(self._documents):
				if frappe.db.exists("Wiki Document", name):
					frappe.delete_doc("Wiki Document", name, force=True, ignore_permissions=True)
			self._documents.clear()

			for name in self._spaces:
				if frappe.db.exists("Wiki Space", name):
					frappe.delete_doc("Wiki Space", name, force=True, ignore_permissions=True)
			self._spaces.clear()

			for doctype, name in reversed(self._others):
				if frappe.db.exists(doctype, name):
					frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			self._others.clear()

			# The deletion has to outlive the framework's post-test rollback.
			# A test that commits its own inserts (the reorder and rebuild APIs
			# commit on their own) leaves rows the rollback cannot reach, and an
			# uncommitted delete of those rows is itself rolled back -- which is
			# how these suites came to leave spaces behind.
			frappe.db.commit()  # nosemgrep: frappe-semgrep-rules.rules.frappe-manual-commit
		finally:
			frappe.flags.in_apply_merge_revision = previous_flag


class WikiFixtureMixin:
	"""Gives a TestCase a ``self.wiki`` factory that tears itself down.

	The factory is built on first use and registers its own ``addCleanup`` there
	and then, so it does not depend on a subclass's ``setUp`` remembering to
	call ``super()`` -- two classes in the Wiki Document suite do not. Cleanup
	runs after every ``tearDown`` in the chain, and still runs when the test
	fails.
	"""

	@property
	def wiki(self) -> WikiFixtures:
		fixtures = getattr(self, "_wiki_fixtures", None)
		if fixtures is None:
			fixtures = WikiFixtures()
			self._wiki_fixtures = fixtures
			self.addCleanup(fixtures.destroy_all)
		return fixtures
