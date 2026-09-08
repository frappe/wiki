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

	def destroy_all(self):
		"""Delete everything this factory made. Safe to call more than once."""
		previous_flag = frappe.flags.in_apply_merge_revision
		frappe.flags.in_apply_merge_revision = True
		try:
			# Leaf-first, so the nested set never blocks on a node with children.
			for name in reversed(self._documents):
				if frappe.db.exists("Wiki Document", name):
					frappe.delete_doc("Wiki Document", name, force=True, ignore_permissions=True)
			self._documents.clear()

			for name in self._spaces:
				if frappe.db.exists("Wiki Space", name):
					frappe.delete_doc("Wiki Space", name, force=True, ignore_permissions=True)
			self._spaces.clear()
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
